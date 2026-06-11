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

// bccdc-wastewater — SOURCES.md: Environment & Conditions (public-health
// surveillance). BCCDC's own respiratory dashboard is a Shiny app with no
// stable data endpoint; the usable feed is the federal PHAC NWMP aggregate CSV
// (health-infobase.canada.ca, ~7.8 MB, OGL-Canada). The ONLY Vancouver Island
// site in it is Victoria — and that series is LAPSED: rows stop at epi-week
// 2025-W34 (2025-08-17) while the dataset overall runs into 2026. The five
// other BC sites are all Metro Vancouver (mainland), so we implement the one
// genuine VI plant (Victoria) per the brief's "closest available, note clearly"
// rule and surface its (stale) trend rather than dropping the source.
//
// readings only, NO snapshot (no map layer — spec: snapshot skip). The CSV's
// measureid column carries four pathogens per plant; emitting them all under a
// single metric at the same weekstart would collide on (stationId, metric, at),
// so each pathogen gets its own snake_case metric. covN2 (SARS-CoV-2) is the
// canonical "viral load" signal and keeps the spec's named metric
// 'wastewater_viral_load'; the others get distinct metrics:
//   covN2 → wastewater_viral_load   fluA → wastewater_flu_a
//   fluB  → wastewater_flu_b        rsv  → wastewater_rsv
// stationId 'bccdc-wastewater:victoria' (one row per plant). The CSV ships no
// unit column — values are PHAC-normalized weekly averages (w_avg) — so the
// unit is recorded as 'normalized'. We dedupe the duplicate aggregate rows
// (site='' mirrors site='Victoria' exactly) by preferring the named site, and
// only emit the most recent RECENT_WEEKS per metric to keep the load bounded;
// insertReadings dedupes (stationId, metric, at) so re-polls are idempotent.
//
// Weekly data, lapsed VI series → daily check is plenty. Cadence: 86400s.
const META: SourceMeta = {
  slug: 'bccdc-wastewater',
  name: 'PHAC wastewater surveillance (Victoria)',
  cluster: 'Environment & Conditions',
  cadenceSec: 86400,
  attribution: 'Public Health Agency of Canada, National Wastewater Monitoring Program',
  licenseNote: 'Open Government Licence – Canada',
};

const URL = 'https://health-infobase.canada.ca/src/data/wastewater/wastewater_aggregate.csv';

// Victoria — the sole VI plant in the NWMP. Coordinates ~ downtown Victoria
// (the city the site reports under) so the reading is geolocatable even though
// no map layer consumes it.
const VICTORIA = { stationId: `${META.slug}:victoria`, lat: 48.4284, lng: -123.3656 } as const;

// Pathogen measureid → metric. covN2 keeps the spec's 'wastewater_viral_load'.
const METRIC_BY_MEASURE: Record<string, string> = {
  covN2: 'wastewater_viral_load',
  fluA: 'wastewater_flu_a',
  fluB: 'wastewater_flu_b',
  rsv: 'wastewater_rsv',
};

const UNIT = 'normalized'; // CSV has no unit column; w_avg is PHAC-normalized
const RECENT_WEEKS = 16; // bound per metric (the VI series is lapsed/weekly)

// Header columns we depend on (verified live):
// Location,site,city,province,country,EpiYear,EpiWeek,weekstart,measureid,w_avg,min,max,populationcoverage,pruid
const COL = {
  site: 1,
  city: 2,
  province: 3,
  weekstart: 7,
  measureid: 8,
  w_avg: 9,
} as const;

interface ParsedRow {
  at: number;
  measureid: string;
  value: number;
}

// Parse the CSV into Victoria readings. The file is clean (no quoted fields,
// no embedded commas, every row 14 columns), so a plain split is safe. We
// filter line-by-line to the Victoria plant before doing any work to keep the
// 7.8 MB payload cheap, prefer the named-site rows over the duplicate aggregate
// (site=''), and take only the most recent RECENT_WEEKS per pathogen.
function parseVictoria(csv: string): ReadingInput[] {
  const lines = csv.split('\n');
  // best[measureid] = sorted-by-at list of the latest rows
  const byMeasure = new Map<string, ParsedRow[]>();
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const f = line.split(',');
    if (f.length < 14) continue;
    if (f[COL.province] !== 'British Columbia' || f[COL.city] !== 'Victoria') continue;
    if (f[COL.site] !== 'Victoria') continue; // skip the duplicate aggregate (site='')
    const measureid = f[COL.measureid];
    const metric = METRIC_BY_MEASURE[measureid];
    if (!metric) continue;
    const value = parseFloat(f[COL.w_avg]);
    const at = Date.parse(f[COL.weekstart] + 'T00:00:00Z');
    if (!Number.isFinite(value) || !Number.isFinite(at)) continue;
    const arr = byMeasure.get(measureid) ?? [];
    arr.push({ at, measureid, value });
    byMeasure.set(measureid, arr);
  }

  const readings: ReadingInput[] = [];
  for (const [measureid, rows] of byMeasure) {
    rows.sort((a, b) => a.at - b.at);
    const recent = rows.slice(-RECENT_WEEKS);
    for (const r of recent) {
      readings.push({
        stationId: VICTORIA.stationId,
        metric: METRIC_BY_MEASURE[measureid],
        value: r.value,
        unit: UNIT,
        at: r.at,
        lat: VICTORIA.lat,
        lng: VICTORIA.lng,
        sourceSlug: META.slug,
      });
    }
  }
  return readings;
}

export const sync = internalAction({
  args: {},
  handler: async (ctx) => {
    try {
      const res = await fetchSource(URL, { timeoutMs: 30_000 });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const csv = await res.text();
      const readings = parseVictoria(csv);
      await ctx.runMutation(internal.feeds.bccdcWastewater.ingest, { readings });
    } catch (e) {
      await ctx.runMutation(internal.feeds.bccdcWastewater.fail, { error: String(e) });
    }
  },
});

export const ingest = internalMutation({
  args: { readings: v.array(v.any()) },
  handler: async (ctx, { readings }) => {
    const inserted = await insertReadings(ctx, readings as ReadingInput[]);
    await reportSuccess(ctx, META, (readings as ReadingInput[]).length);
    return { inserted };
  },
});

export const fail = internalMutation({
  args: { error: v.string() },
  handler: async (ctx, { error }) => {
    await reportFailure(ctx, META, error);
  },
});
