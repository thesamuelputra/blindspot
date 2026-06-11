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

// noaa-ndbc-buoys — SOURCES.md: Seas (Marine). NDBC realtime2 fixed-width text,
// no auth, newest row first, 'MM' = missing. Canadian (ECCC) buoys are read via
// their NDBC mirrors (46131/46132/46146/46206) per the catalog gotcha — simpler
// parsing than SWOB-ML at slight extra latency. Worst case 6 stations × 6
// metrics = 36 readings/sync + one stations:noaa-ndbc-buoys snapshot row.
// Cadence: medium lane (900s; NDBC cache-control max-age=600, US buoys 10-min,
// Canadian hourly).
const META: SourceMeta = {
  slug: 'noaa-ndbc-buoys',
  name: 'NDBC Marine Buoys',
  cluster: 'Seas (Marine)',
  cadenceSec: 900,
  attribution: 'NOAA/NDBC · Environment and Climate Change Canada',
};

// Island-relevant stations per SOURCES.md (all verified 200 on 2026-06-11).
// Realtime2 files carry no coordinates — lat/lng from NDBC station_table.txt.
const STATIONS = [
  { id: '46087', label: 'Neah Bay', lat: 48.493, lng: -124.727 },
  { id: '46088', label: 'New Dungeness', lat: 48.332, lng: -123.179 },
  { id: '46131', label: 'Sentry Shoal', lat: 49.91, lng: -124.98 },
  { id: '46132', label: 'South Brooks', lat: 49.78, lng: -127.89 },
  { id: '46146', label: 'Halibut Bank', lat: 49.34, lng: -123.73 },
  { id: '46206', label: 'La Perouse Bank', lat: 48.84, lng: -126.0 },
] as const;

// Upstream column → our metric name + honest unit (upstream units row:
// WDIR degT, WSPD m/s, WVHT m, PRES hPa, ATMP/WTMP degC).
const METRICS: Array<{ col: string; metric: string; unit: string }> = [
  { col: 'WVHT', metric: 'wave_height', unit: 'm' },
  { col: 'WSPD', metric: 'wind_speed', unit: 'm/s' },
  { col: 'WDIR', metric: 'wind_dir', unit: 'deg' },
  { col: 'WTMP', metric: 'water_temp', unit: '°C' },
  { col: 'ATMP', metric: 'air_temp', unit: '°C' },
  { col: 'PRES', metric: 'pressure', unit: 'hPa' },
];

interface SnapshotStation {
  id: string;
  label: string;
  lat: number;
  lng: number;
  value: number | null;
  unit: string;
  at: number;
}

// Parse the newest data row of a realtime2 file. Line 1 = '#YY MM DD hh mm …'
// header, line 2 = '#yr mo …' units, then newest-first rows; 'MM' = missing.
// (The month column is also named MM but always holds a number, so no clash.)
function parseLatest(text: string): { at: number; get: (col: string) => number | null } | null {
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length < 3 || !lines[0].startsWith('#')) return null;
  const cols = lines[0].replace(/^#/, '').trim().split(/\s+/);
  const row = lines.find((l) => !l.startsWith('#'));
  if (!row) return null;
  const tokens = row.trim().split(/\s+/);
  const get = (col: string): number | null => {
    const i = cols.indexOf(col);
    if (i < 0 || i >= tokens.length || tokens[i] === 'MM') return null;
    const n = Number(tokens[i]);
    return Number.isFinite(n) ? n : null;
  };
  const yy = get('YY');
  const mo = get('MM');
  const dd = get('DD');
  const hh = get('hh');
  const mn = get('mm');
  if (yy === null || mo === null || dd === null || hh === null || mn === null) return null;
  return { at: Date.UTC(yy, mo - 1, dd, hh, mn), get };
}

export const sync = internalAction({
  args: {},
  handler: async (ctx) => {
    const readings: ReadingInput[] = [];
    const stations: SnapshotStation[] = [];
    const errors: string[] = [];
    const results = await Promise.allSettled(
      STATIONS.map(async (s) => {
        const res = await fetchSource(`https://www.ndbc.noaa.gov/data/realtime2/${s.id}.txt`);
        if (!res.ok) throw new Error(`${s.id}: HTTP ${res.status}`);
        return { station: s, text: await res.text() };
      }),
    );
    for (const r of results) {
      if (r.status === 'rejected') {
        errors.push(String(r.reason));
        continue;
      }
      const { station, text } = r.value;
      const latest = parseLatest(text);
      if (!latest) {
        errors.push(`${station.id}: unparseable realtime2 payload`);
        continue;
      }
      for (const { col, metric, unit } of METRICS) {
        const value = latest.get(col);
        if (value === null) continue; // only metrics present per buoy
        readings.push({
          stationId: `${META.slug}:${station.id}`,
          metric,
          value,
          unit,
          at: latest.at,
          lat: station.lat,
          lng: station.lng,
          sourceSlug: META.slug,
        });
      }
      // Headline value: wave_height, falling back to wind_speed (spec).
      const wvht = latest.get('WVHT');
      const wspd = latest.get('WSPD');
      stations.push({
        id: station.id,
        label: station.label,
        lat: station.lat,
        lng: station.lng,
        value: wvht ?? wspd,
        unit: wvht !== null ? 'm' : 'm/s',
        at: latest.at,
      });
    }
    if (stations.length === 0) {
      await ctx.runMutation(internal.feeds.ndbcBuoys.fail, {
        error: errors.join('; ') || 'no stations returned data',
      });
      return;
    }
    await ctx.runMutation(internal.feeds.ndbcBuoys.ingest, {
      readings,
      snapshotJson: JSON.stringify(stations),
    });
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
