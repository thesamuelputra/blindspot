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

// sst-chlorophyll — SOURCES.md: Environment & Conditions. NOAA CoastWatch
// ERDDAP, MUR SST (jplMURSST41, 0.01°, daily, ~1 day latency). No auth.
// One tiny single-point griddap subset per station per sync — never the full
// VI bbox (~85k points unstrided). Queries run sequentially: ERDDAP asks for
// considerate use and throttles heavy concurrency. (last) over open water is
// effectively gap-free for MUR; inner inlets can be null → skipped.
// Worst case 4 readings/sync. Cadence: 21600s (daily product).
const META: SourceMeta = {
  slug: 'sst-chlorophyll',
  name: 'NOAA CoastWatch ERDDAP (MUR SST)',
  cluster: 'Environment & Conditions',
  cadenceSec: 21600,
  attribution: 'NOAA CoastWatch West Coast Node · JPL MUR MEaSUREs Project',
};

// VI-water sample points, all live-verified to return finite analysed_sst
// (2026-06-11). MUR grid snaps to the requested coordinate.
const POINTS = [
  { id: 'juan-de-fuca', label: 'Juan de Fuca Mouth', lat: 48.45, lng: -124.8 },
  { id: 'georgia-strait', label: 'Georgia Strait Mid', lat: 49.3, lng: -123.8 },
  { id: 'la-perouse', label: 'La Perouse Bank', lat: 48.84, lng: -126.0 },
  { id: 'johnstone-strait', label: 'Johnstone Strait', lat: 50.6, lng: -126.8 },
] as const;

function pointUrl(lat: number, lng: number): string {
  // Brackets must stay URL-encoded; (last) = newest daily composite.
  return (
    'https://coastwatch.pfeg.noaa.gov/erddap/griddap/jplMURSST41.json?' +
    `analysed_sst%5B(last)%5D%5B(${lat}):1:(${lat})%5D%5B(${lng}):1:(${lng})%5D`
  );
}

interface ErddapTable {
  table: {
    columnNames: string[]; // [time, latitude, longitude, analysed_sst]
    rows: Array<[string, number, number, number | null]>;
  };
}

export const sync = internalAction({
  args: {},
  handler: async (ctx) => {
    const readings: ReadingInput[] = [];
    const errors: string[] = [];
    for (const p of POINTS) {
      try {
        const res = await fetchSource(pointUrl(p.lat, p.lng));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as ErddapTable;
        const row = data.table?.rows?.[0];
        if (!row) throw new Error('empty table');
        const [time, , , sst] = row;
        const at = Date.parse(time);
        if (typeof sst !== 'number' || !Number.isFinite(at)) continue; // null over land/inlets
        readings.push({
          // stationId prefix 'sst:' per spec (sourceSlug field carries the
          // full catalog slug).
          stationId: `sst:${p.id}`,
          metric: 'sst',
          value: sst,
          unit: '°C',
          at,
          lat: p.lat,
          lng: p.lng,
          sourceSlug: META.slug,
        });
      } catch (e) {
        errors.push(`${p.id}: ${String(e)}`);
      }
    }
    if (readings.length === 0) {
      await ctx.runMutation(internal.feeds.sstErddap.fail, {
        error: errors.join('; ') || 'no SST points returned data',
      });
      return;
    }
    await ctx.runMutation(internal.feeds.sstErddap.ingest, { readings });
  },
});

export const ingest = internalMutation({
  args: { readings: v.array(v.any()) },
  handler: async (ctx, { readings }) => {
    const inserted = await insertReadings(ctx, readings as ReadingInput[]);
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
