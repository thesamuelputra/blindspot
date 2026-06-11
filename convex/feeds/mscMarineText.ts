import { v } from 'convex/values';
import { internalAction, internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { fetchSource } from '../lib/fetchSource';
import { parseXml, asArray } from '../lib/xml';
import { cellOf } from '../lib/geo';
import { upsertSignals, reportSuccess, reportFailure, type SourceMeta } from '../lib/ingest';

// msc-marine-text — SOURCES.md: MSC Datamart Marine Text Forecasts (Pacific).
// Day-rooted Datamart tree (no stable 'latest' URL): list the day's pacific/
// hour folders, take the newest few, pick the lexicographically last
// _MSC_MarineWeather_{area}_en.xml per VI water area, parse <warnings>.
// Signals (kind 'marine-notice') for WARNINGS only — one per (area, warning
// type) with the routine forecast wind text as summary. Worst case 7 areas ×
// ~2 warning types = ~14 signals/sync; ~12 HTTP requests (1 day listing + 3
// hour listings + 7 XMLs). Cadence: slow lane (1800s; upstream issues ~4x/day
// plus amendments, Cache-Control max-age=300).
const META: SourceMeta = {
  slug: 'msc-marine-text',
  name: 'MSC Marine Text Forecasts',
  cluster: 'Seas (Marine)',
  cadenceSec: 1800,
  attribution: 'Data Source: Environment and Climate Change Canada',
};

const ROOT = 'https://dd.weather.gc.ca';

// VI water areas (codes from regionList.xml per SOURCES.md, verified live
// 2026-06-11). Centroids are hand-placed representative points for the map
// layer — these are text products with no upstream geometry.
const AREAS = [
  { code: 'm0000009', label: 'Juan de Fuca Strait', lat: 48.35, lng: -124.2 },
  { code: 'm0000028', label: 'Strait of Georgia', lat: 49.25, lng: -123.8 },
  { code: 'm0000043', label: 'West Coast Vancouver Island North', lat: 50.1, lng: -128.3 },
  { code: 'm0000065', label: 'West Coast Vancouver Island South', lat: 48.9, lng: -126.2 },
  { code: 'm0000064', label: 'Haro Strait', lat: 48.55, lng: -123.2 },
  { code: 'm0000010', label: 'Johnstone Strait', lat: 50.45, lng: -126.2 },
  { code: 'm0000112', label: 'Queen Charlotte Strait', lat: 50.75, lng: -127.45 },
] as const;

type Severity = 'info' | 'watch' | 'warning' | 'critical';

// Severity mapping (event @_name in <warnings>): ECCC's marine warning ladder
// is strong wind (the small-craft tier) < gale < storm < hurricane force.
// Spec: small-craft=watch, gale=warning, storm/hurricane=critical. Unknown
// warning types stay conservative at watch.
function severityOf(warningName: string): Severity {
  const n = warningName.toLowerCase();
  if (n.includes('storm') || n.includes('hurricane')) return 'critical';
  if (n.includes('gale')) return 'warning';
  return 'watch'; // strong wind / small craft / unrecognized
}

// "202606111100" (UTC) → epoch ms. fast-xml-parser may hand this back as a
// number, so normalize via String().
function parseTimeStamp(ts: unknown): number | undefined {
  const s = String(ts ?? '');
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(s);
  if (!m) return undefined;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
}

interface XmlDateTime {
  '@_zone'?: string;
  timeStamp?: unknown;
}

interface XmlEvent {
  '@_type'?: string;
  '@_name'?: string;
  '@_status'?: string;
  dateTime?: XmlDateTime | XmlDateTime[];
}

interface XmlLocation {
  '@_name'?: string;
  event?: XmlEvent | XmlEvent[];
}

interface XmlForecastLocation {
  '@_name'?: string;
  weatherCondition?: { wind?: string } | Array<{ wind?: string }>;
}

function utcIssued(e: XmlEvent): number | undefined {
  const dt = asArray(e.dateTime).find((d) => d['@_zone'] === 'UTC');
  return dt ? parseTimeStamp(dt.timeStamp) : undefined;
}

// List a Datamart directory and pull out matching hrefs.
async function listHrefs(url: string, pattern: RegExp): Promise<string[]> {
  const res = await fetchSource(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} listing ${url}`);
  const html = await res.text();
  const out: string[] = [];
  for (const m of html.matchAll(pattern)) out.push(m[1]);
  return out;
}

function dayPath(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

export const sync = internalAction({
  args: {},
  handler: async (ctx) => {
    try {
      // The day tree rolls at UTC midnight; right after the roll today's
      // folder can be missing or empty, so fall back to yesterday.
      const now = new Date();
      const days = [dayPath(now), dayPath(new Date(now.getTime() - 86_400_000))];
      let latestByArea = new Map<string, string>(); // code → absolute file URL
      for (const day of days) {
        const base = `${ROOT}/${day}/WXO-DD/marine_weather/pacific`;
        let hours: string[] = [];
        try {
          hours = (await listHrefs(`${base}/`, /href="(\d{2})\/"/g)).sort();
        } catch {
          continue; // day folder not there (yet/anymore)
        }
        const byArea = new Map<string, string>();
        // Newest 3 hour folders cover the latest issuance plus amendments.
        for (const hour of hours.slice(-3)) {
          const files = await listHrefs(
            `${base}/${hour}/`,
            /href="([0-9TZ.]+_MSC_MarineWeather_m\d+_en\.xml)"/g,
          );
          for (const file of files.sort()) {
            const code = /_MSC_MarineWeather_(m\d+)_en\.xml$/.exec(file)?.[1];
            if (!code) continue;
            const prev = byArea.get(code);
            // Filenames start with the ISO publication timestamp, so the
            // lexicographically larger name is the newer publication.
            if (!prev || file > prev.split('/').pop()!) {
              byArea.set(code, `${base}/${hour}/${file}`);
            }
          }
        }
        if (byArea.size > 0) {
          latestByArea = byArea;
          break;
        }
      }
      if (latestByArea.size === 0) throw new Error('no marine forecast files found in day tree');

      const fetchedAt = Date.now();
      const signals = [];
      let parsedAreas = 0;
      for (const area of AREAS) {
        const url = latestByArea.get(area.code);
        if (!url) continue; // area absent from recent folders — skip, not fatal
        const res = await fetchSource(url);
        if (!res.ok) continue;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const doc: any = parseXml(await res.text());
        const marine = doc?.marineData;
        if (!marine) continue;
        parsedAreas++;

        // Routine forecast wind text per sub-location (for warning summaries).
        const windByLocation = new Map<string, string>();
        for (const loc of asArray<XmlForecastLocation>(marine.regularForecast?.location)) {
          const wind = asArray(loc.weatherCondition)
            .map((w) => (typeof w?.wind === 'string' ? w.wind : ''))
            .find((t) => t.length > 0);
          if (loc['@_name'] && wind) windByLocation.set(loc['@_name'], wind);
        }

        // Aggregate IN EFFECT warnings: one signal per (area, warning type),
        // listing the sub-locations under it.
        const byWarning = new Map<string, { locations: string[]; issuedAt?: number }>();
        for (const loc of asArray<XmlLocation>(marine.warnings?.location)) {
          for (const event of asArray(loc.event)) {
            if (event['@_type'] !== 'warning' || event['@_status'] !== 'IN EFFECT') continue;
            const name = event['@_name'] ?? 'Marine warning';
            const entry = byWarning.get(name) ?? { locations: [] };
            if (loc['@_name']) entry.locations.push(loc['@_name']);
            entry.issuedAt = entry.issuedAt ?? utcIssued(event);
            byWarning.set(name, entry);
          }
        }

        for (const [warningName, info] of byWarning) {
          const windText = info.locations
            .map((l) => windByLocation.get(l))
            .find((t) => t !== undefined);
          const where = info.locations.join('; ');
          const summary = [where, windText].filter(Boolean).join('. ').slice(0, 500);
          const observedAt = info.issuedAt ?? fetchedAt;
          const typeSlug = warningName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
          signals.push({
            sourceSlug: META.slug,
            kind: 'marine-notice',
            title: `${warningName} — ${area.label}`,
            summary: summary || undefined,
            severity: severityOf(warningName),
            lat: area.lat,
            lng: area.lng,
            cell: cellOf(area.lat, area.lng),
            observedAt,
            // Refreshed every sync while the warning stays IN EFFECT; ended
            // warnings vanish upstream and age out within 12h.
            expiresAt: fetchedAt + 12 * 3600 * 1000,
            dedupeKey: `${META.slug}:${area.code}:${typeSlug}`,
            confidence: 1.0, // agency forecast (ECCC)
            provenance: JSON.stringify({ method: 'poll', fetchedAt, upstreamId: area.code, url }),
            raw: JSON.stringify({ warning: warningName, locations: info.locations }).slice(0, 2000),
          });
        }
      }
      if (parsedAreas === 0) throw new Error('no area XML parsed');
      await ctx.runMutation(internal.feeds.mscMarineText.ingest, { signals });
    } catch (e) {
      await ctx.runMutation(internal.feeds.mscMarineText.fail, { error: String(e) });
    }
  },
});

export const ingest = internalMutation({
  args: { signals: v.array(v.any()) },
  handler: async (ctx, { signals }) => {
    const { inserted, updated } = await upsertSignals(ctx, signals);
    await reportSuccess(ctx, META, signals.length);
    return { inserted, updated };
  },
});

export const fail = internalMutation({
  args: { error: v.string() },
  handler: async (ctx, { error }) => {
    await reportFailure(ctx, META, error);
  },
});
