import { v } from 'convex/values';
import { internalAction, internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { fetchSource } from '../lib/fetchSource';
import {
  insertReadings,
  reportSuccess,
  reportFailure,
  type ReadingInput,
  type SourceMeta,
} from '../lib/ingest';
import { writeSnapshot } from '../lib/movers';

// dfo-lightstations — SOURCES.md: BC Lightstation Observations. Honest catalog
// finding: the named open.canada.ca live dataset does NOT exist — the live
// 3-4x-daily human observations are published only as one server-rendered
// weather.gc.ca HTML page (all South Coast lightstations), so parse that.
// Coded lines like "NOOTKA  CLDY 15 N04E 1FT CHP LO SW" = sky, visibility
// (mi), wind dir+speed kt (E=estimated), sea height ft + character. Numeric
// fields → readings (wind_speed kt, visibility mi, sea_height ft); the
// qualitative sky/sea-character text is skipped per spec. Stations are often
// NOT AVAILABLE — per-station skip, fail only when zero parse. Worst case 16
// stations × 3 metrics = 48 readings/sync + one stations:dfo-lightstations
// snapshot. Cadence: slow lane (3600s; obs are human-made ~3-4x daily).
const META: SourceMeta = {
  slug: 'dfo-lightstations',
  name: 'BC Lightstation Observations',
  cluster: 'Seas (Marine)',
  cadenceSec: 3600,
  attribution: 'Environment and Climate Change Canada',
};

const URL = 'https://weather.gc.ca/marine/weatherConditions-lightstation_e.html?mapID=02&siteID=16200';

// VI-relevant stations verified on the live page (SOURCES.md). The curated
// list IS the VI filter — the page's first section (Dixon Entrance/Hecate/
// Central Coast) simply has no entries here. Page codes are the fixed-width
// names in column 1; coordinates are the lightstation positions (approximate,
// info layer grade).
const STATIONS: Record<string, { label: string; lat: number; lng: number }> = {
  NOOTKA: { label: 'Nootka', lat: 49.592, lng: -126.616 },
  ESTEVAN: { label: 'Estevan Point', lat: 49.383, lng: -126.544 },
  LENNARD: { label: 'Lennard Island', lat: 49.11, lng: -125.922 },
  'CAPE BEALE': { label: 'Cape Beale', lat: 48.786, lng: -125.214 },
  CHATHAM: { label: 'Chatham Point', lat: 50.333, lng: -125.443 },
  'CAPE MUDGE': { label: 'Cape Mudge', lat: 49.998, lng: -125.195 },
  PULTENEY: { label: 'Pulteney Point', lat: 50.628, lng: -127.156 },
  SCARLETT: { label: 'Scarlett Point', lat: 50.863, lng: -127.604 },
  'PINE ISLAND': { label: 'Pine Island', lat: 50.976, lng: -127.728 },
  'EGG ISLAND': { label: 'Egg Island', lat: 51.247, lng: -127.836 },
  'CAPE SCOTT': { label: 'Cape Scott', lat: 50.782, lng: -128.429 },
  QUATSINO: { label: 'Quatsino (Kains Island)', lat: 50.448, lng: -128.036 },
  CHROME: { label: 'Chrome Island', lat: 49.472, lng: -124.683 },
  MERRY: { label: 'Merry Island', lat: 49.468, lng: -123.913 },
  ENTRANCE: { label: 'Entrance Island', lat: 49.209, lng: -123.811 },
  'TRIAL IS': { label: 'Trial Island', lat: 48.396, lng: -123.305 },
};

const MONTHS: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

// "14:40 UTC 11 June 2026" → epoch ms
function parseIssued(text: string): number | undefined {
  const m = /(\d{1,2}):(\d{2})\s*UTC\s*(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/.exec(text);
  if (!m) return undefined;
  const month = MONTHS[m[4].toLowerCase()];
  if (month === undefined) return undefined;
  return Date.UTC(+m[5], month, +m[3], +m[1], +m[2]);
}

interface ParsedObs {
  windSpeedKt?: number;
  visibilityMi?: number;
  seaHeightFt?: number;
}

// Coded observation line after the 14-char name column, e.g.
// "CLDY 15 N04E 1FT CHP LO SW" / "OVC 15 CLM RPLD" / "PC 15 NW06E 1 FT CHP".
// Decode guide: canada.ca 'Decode information for lighthouse reports'.
function parseObs(rest: string): ParsedObs | undefined {
  if (!rest || /^(N\/A|NOT AVAILABLE)/i.test(rest)) return undefined;
  const obs: ParsedObs = {};
  const tokens = rest.split(/\s+/);
  // visibility: first bare-number token (statute miles), before any wind code
  for (const t of tokens.slice(1)) {
    if (/^\d{1,2}$/.test(t)) {
      obs.visibilityMi = +t;
      break;
    }
    if (/^(CLM|[NESW]{1,3}\d)/.test(t)) break;
  }
  // wind: CLM = calm, else <dir><speed kt>[E for estimated]
  for (const t of tokens) {
    if (t === 'CLM') {
      obs.windSpeedKt = 0;
      break;
    }
    const w = /^([NESW]{1,3})(\d{1,3})E?$/.exec(t);
    if (w) {
      obs.windSpeedKt = +w[2];
      break;
    }
  }
  // sea height: "1FT" or "1 FT" (the qualitative character codes are skipped)
  const sea = /(\d+(?:\.\d+)?)\s*FT\b/.exec(rest);
  if (sea) obs.seaHeightFt = +sea[1];
  if (obs.windSpeedKt === undefined && obs.visibilityMi === undefined && obs.seaHeightFt === undefined) {
    return undefined;
  }
  return obs;
}

interface SnapshotStation {
  id: string;
  label: string;
  lat: number;
  lng: number;
  value: number | null;
  unit: string;
  at: number;
}

export const sync = internalAction({
  args: {},
  handler: async (ctx) => {
    try {
      const res = await fetchSource(URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      const readings: ReadingInput[] = [];
      const stations: SnapshotStation[] = [];
      // Sections: <h3>{area}</h3><span class="text-info">Issued at&nbsp;{t}
      // </span><pre class="bulletintext">{coded lines}</pre>
      const sections = html.matchAll(
        /<h3>[\s\S]*?<\/h3><span class="text-info">([\s\S]*?)<\/span><pre class="bulletintext">([\s\S]*?)<\/pre>/g,
      );
      for (const [, issuedHtml, body] of sections) {
        const at = parseIssued(issuedHtml.replace(/&nbsp;/g, ' ')) ?? Date.now();
        for (const line of body.split('\n')) {
          // main block only — the SUPPLEMENTARY section repeats stations with
          // cloud/temp codes we don't extract
          if (/SUPPLEMENTARY WEATHER INFORMATION/.test(line)) break;
          const code = line.slice(0, 14).trim();
          const station = STATIONS[code];
          if (!station) continue; // non-VI station or blank line
          const obs = parseObs(line.slice(14).trim());
          if (!obs) continue; // NOT AVAILABLE / unparseable — skip, not fatal
          const stationId = `${META.slug}:${code.replace(/\s+/g, '_')}`;
          const push = (metric: string, value: number | undefined, unit: string) => {
            if (value === undefined) return;
            readings.push({
              stationId,
              metric,
              value,
              unit,
              at,
              lat: station.lat,
              lng: station.lng,
              sourceSlug: META.slug,
            });
          };
          push('wind_speed', obs.windSpeedKt, 'kt');
          push('visibility', obs.visibilityMi, 'mi');
          push('sea_height', obs.seaHeightFt, 'ft');
          stations.push({
            id: code.replace(/\s+/g, '_'),
            label: station.label,
            lat: station.lat,
            lng: station.lng,
            value: obs.windSpeedKt ?? obs.seaHeightFt ?? obs.visibilityMi ?? null,
            unit: obs.windSpeedKt !== undefined ? 'kt' : obs.seaHeightFt !== undefined ? 'ft' : 'mi',
            at,
          });
        }
      }
      if (stations.length === 0) {
        throw new Error('no lightstation observations parsed (all N/A or markup changed)');
      }
      await ctx.runMutation(internal.feeds.dfoLightstations.ingest, {
        readings,
        snapshotJson: JSON.stringify(stations),
      });
    } catch (e) {
      await ctx.runMutation(internal.feeds.dfoLightstations.fail, { error: String(e) });
    }
  },
});

export const ingest = internalMutation({
  args: { readings: v.array(v.any()), snapshotJson: v.string() },
  handler: async (ctx, { readings, snapshotJson }) => {
    const inserted = await insertReadings(ctx, readings as ReadingInput[]);
    await writeSnapshot(ctx, `stations:${META.slug}`, snapshotJson);
    await reportSuccess(ctx, META, readings.length);
    return { inserted };
  },
});

export const fail = internalMutation({
  args: { error: v.string() },
  handler: async (ctx, { error }) => {
    await reportFailure(ctx, META, error);
  },
});
