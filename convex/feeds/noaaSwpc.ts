import { v } from 'convex/values';
import { internalAction, internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { fetchSource } from '../lib/fetchSource';
import {
  insertReadings,
  upsertSignals,
  reportSuccess,
  reportFailure,
  type ReadingInput,
  type SignalInput,
  type SourceMeta,
} from '../lib/ingest';

// noaa-swpc — SOURCES.md: Space Weather. Five keyless SWPC products, only the
// LATEST sample per series each sync (gauges land on the SPACE page, Phase 5):
//   Kp 1-min                 → readings noaa-swpc:planetary     kp_index
//   solar wind plasma (2 h)  → readings noaa-swpc:l1            solar_wind_speed / solar_wind_density
//   solar wind mag (2 h)     → readings noaa-swpc:l1            imf_bz
//   GOES X-ray (6 h)         → readings noaa-swpc:goes-primary  xray_flux (long band 0.1–0.8 nm,
//                               the band used for flare classification; W/m2 stored as-is)
//   products/alerts.json     → signals kind 'space-weather' (non-geographic: no lat/lng/cell)
// The products/solar-wind files are array-of-arrays with a header row and
// STRING values — parseFloat everything, scan backwards per column for the
// last finite value (trailing minutes can be null). The 2-hour windows are
// used instead of json/rtsw/*_1m.json: those are ~2.6 MB, newest-first, and
// the newest rows can come from a non-active spacecraft (seen: ACE,
// active:false). Per SOURCES.md the active L1 monitor is no longer DSCOVR
// (SOLAR1/IMAP) — the station is labelled generically 'l1'.
// Cadence: 300s (CloudFront caches every response for 60s anyway).
const META: SourceMeta = {
  slug: 'noaa-swpc',
  name: 'NOAA SWPC (Kp / solar wind / X-ray / alerts)',
  cluster: 'Space Weather',
  cadenceSec: 300,
  attribution: 'NOAA Space Weather Prediction Center',
};

const KP_URL = 'https://services.swpc.noaa.gov/json/planetary_k_index_1m.json';
const PLASMA_URL = 'https://services.swpc.noaa.gov/products/solar-wind/plasma-2-hour.json';
const MAG_URL = 'https://services.swpc.noaa.gov/products/solar-wind/mag-2-hour.json';
const XRAY_URL = 'https://services.swpc.noaa.gov/json/goes/primary/xrays-6-hour.json';
const ALERTS_URL = 'https://services.swpc.noaa.gov/products/alerts.json';

// Bulletins older than this are history, not active operations — alerts.json
// reaches back weeks. upsertSignals dedupes re-polls by dedupeKey.
const ALERT_WINDOW_MS = 72 * 60 * 60 * 1000;

interface KpRow {
  time_tag: string;
  kp_index: number;
  estimated_kp: number | null;
}

interface XrayRow {
  time_tag: string;
  flux: number | null;
  energy: string; // '0.05-0.4nm' | '0.1-0.8nm' — two rows per minute, one per band
}

interface AlertRow {
  product_id: string;
  issue_datetime: string; // '2026-06-11 00:40:57.837' (UTC, no zone)
  message: string; // raw multi-line bulletin
}

type ProductRows = Array<Array<string | null>>; // row 0 = header, values are strings

// SWPC time tags arrive in three flavours, all UTC without an offset:
// '2026-06-11T14:36:00' (Kp), '2026-06-11 14:35:00.000' (products/alerts),
// '2026-06-11T14:36:00Z' (GOES).
function parseUtc(s: string): number {
  const iso = s.trim().replace(' ', 'T');
  return Date.parse(iso.endsWith('Z') ? iso : iso + 'Z');
}

// Bulletin body times look like '2026 Jun 09 2359 UTC'.
const MONTHS: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

function parseBulletinTime(s: string): number | undefined {
  const m = /(\d{4}) ([A-Z][a-z]{2}) (\d{1,2}) (\d{2})(\d{2})/.exec(s);
  if (!m) return undefined;
  const month = MONTHS[m[2]];
  if (month === undefined) return undefined;
  return Date.UTC(+m[1], month, +m[3], +m[4], +m[5]);
}

// Last row (scanning backwards, skipping the header) whose named column
// parses to a finite number — trailing minutes go null independently per column.
function lastFinite(rows: ProductRows, col: string): { value: number; at: number } | null {
  const header = rows[0] ?? [];
  const idx = header.indexOf(col);
  if (idx < 0) return null;
  for (let i = rows.length - 1; i >= 1; i--) {
    const value = parseFloat(rows[i][idx] ?? '');
    const at = parseUtc(rows[i][0] ?? '');
    if (Number.isFinite(value) && Number.isFinite(at)) return { value, at };
  }
  return null;
}

// Severity by message type (per spec): WATCH → watch; WARNING / EXTENDED
// WARNING → warning; ALERT / CONTINUED ALERT → warning; SUMMARY and
// CANCELLED * → info. Escalation to critical for extreme conditions —
// G4/G5 geomagnetic storm (incl. 'K-index of 8/9') or an X-class X-ray event
// ('X-ray Event exceeded X1', 'Class: X1.0') — applied to every non-cancelled
// type so an after-the-fact X-class SUMMARY still surfaces as critical.
const EXTREME = /\bG[45]\b|K-index of [89]\b|X-ray (?:Event|Flux) exceeded X|Class:\s*X\d/i;

function severityOf(type: string, message: string): SignalInput['severity'] {
  if (type.startsWith('CANCELLED')) return 'info';
  if (EXTREME.test(message)) return 'critical';
  if (type.endsWith('WATCH')) return 'watch';
  if (type.endsWith('WARNING') || type.endsWith('ALERT')) return 'warning';
  return 'info'; // SUMMARY and anything unrecognized
}

export const sync = internalAction({
  args: {},
  handler: async (ctx) => {
    try {
      const urls = [KP_URL, PLASMA_URL, MAG_URL, XRAY_URL, ALERTS_URL];
      const responses = await Promise.all(urls.map((u) => fetchSource(u)));
      responses.forEach((res, i) => {
        if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(urls[i]).pathname}`);
      });
      const [kp, plasma, mag, xray, alerts] = (await Promise.all(
        responses.map((r) => r.json()),
      )) as [KpRow[], ProductRows, ProductRows, XrayRow[], AlertRow[]];
      const fetchedAt = Date.now();

      // ---- readings: one latest sample per series ----
      const readings: ReadingInput[] = [];

      const lastKp = kp[kp.length - 1];
      if (lastKp) {
        readings.push({
          stationId: `${META.slug}:planetary`,
          metric: 'kp_index',
          value: lastKp.estimated_kp ?? lastKp.kp_index,
          unit: 'index',
          at: parseUtc(lastKp.time_tag),
          sourceSlug: META.slug,
        });
      }

      const series: Array<[ProductRows, string, string, string]> = [
        [plasma, 'speed', 'solar_wind_speed', 'km/s'],
        [plasma, 'density', 'solar_wind_density', 'p/cm³'],
        [mag, 'bz_gsm', 'imf_bz', 'nT'],
      ];
      for (const [rows, col, metric, unit] of series) {
        const latest = lastFinite(rows, col);
        if (latest) {
          readings.push({
            stationId: `${META.slug}:l1`,
            metric,
            value: latest.value,
            unit,
            at: latest.at,
            sourceSlug: META.slug,
          });
        }
      }

      for (let i = xray.length - 1; i >= 0; i--) {
        const row = xray[i];
        if (row.energy === '0.1-0.8nm' && typeof row.flux === 'number') {
          readings.push({
            stationId: `${META.slug}:goes-primary`,
            metric: 'xray_flux',
            value: row.flux,
            unit: 'W/m2',
            at: parseUtc(row.time_tag),
            sourceSlug: META.slug,
          });
          break;
        }
      }

      // ---- signals: active alerts/watches/warnings ----
      const signals: SignalInput[] = [];
      for (const a of alerts) {
        const observedAt = parseUtc(a.issue_datetime);
        if (!Number.isFinite(observedAt) || fetchedAt - observedAt > ALERT_WINDOW_MS) continue;
        const code = /Space Weather Message Code:\s*(\S+)/.exec(a.message)?.[1];
        const serial = /Serial Number:\s*(\d+)/.exec(a.message)?.[1];
        // e.g. 'ALERT: Type IV Radio Emission', 'EXTENDED WARNING: Geomagnetic
        // K-index of 5 expected', 'CANCELLED WATCH: Geomagnetic Storm Category
        // G3 Predicted' — the code+serial pair is the stable upstream identity.
        const head = /^((?:CANCELLED |CONTINUED |EXTENDED )?(?:ALERT|WARNING|WATCH|SUMMARY)):\s*(\S.*)$/m.exec(
          a.message,
        );
        const type = head?.[1] ?? 'BULLETIN';
        const validTo = /Valid To:\s*([^\r\n]+UTC)/.exec(a.message)?.[1];
        signals.push({
          sourceSlug: META.slug,
          kind: 'space-weather',
          title: head ? `${type}: ${head[2].trim()}`.slice(0, 140) : `${a.product_id} space weather bulletin`,
          summary: code && serial ? `${code} #${serial}` : undefined,
          severity: severityOf(type, a.message),
          // non-geographic signal — no lat/lng/cell
          observedAt,
          expiresAt: validTo ? parseBulletinTime(validTo) : undefined,
          dedupeKey: `${META.slug}:${code ?? a.product_id}:${serial ?? String(observedAt)}`,
          confidence: 1.0,
          provenance: JSON.stringify({
            method: 'poll',
            fetchedAt,
            upstreamId: code && serial ? `${code}:${serial}` : a.product_id,
            url: ALERTS_URL,
          }),
          raw: a.message.slice(0, 1800),
        });
      }

      await ctx.runMutation(internal.feeds.noaaSwpc.ingest, { readings, signals });
    } catch (e) {
      await ctx.runMutation(internal.feeds.noaaSwpc.fail, { error: String(e) });
    }
  },
});

export const ingest = internalMutation({
  args: { readings: v.array(v.any()), signals: v.array(v.any()) },
  handler: async (ctx, { readings, signals }) => {
    await insertReadings(ctx, readings as ReadingInput[]);
    const { inserted, updated } = await upsertSignals(ctx, signals as SignalInput[]);
    await reportSuccess(ctx, META, readings.length + signals.length);
    return { inserted, updated };
  },
});

export const fail = internalMutation({
  args: { error: v.string() },
  handler: async (ctx, { error }) => {
    await reportFailure(ctx, META, error);
  },
});
