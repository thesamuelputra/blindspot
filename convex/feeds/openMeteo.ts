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

// open-meteo — SOURCES.md: Weather & Atmosphere. Free non-commercial tier, no
// auth, CORS *. Model conditions for points where real stations thin out
// (outer coast / mid-strait). One BATCHED call covers all four points:
// comma-separated latitude/longitude lists return a JSON ARRAY of per-location
// objects in request order (location_id present on every element except the
// first — verified live 2026-06-11). 96 calls/day at 900s, far under the free
// tier (<10,000/day). We request wind_speed_unit=kn and timeformat=unixtime
// (both supported; default wind unit is km/h).
//
// CONFIDENCE NOTE: these are 15-minute model blends (current.interval=900),
// not station observations — confidence 0.6 (aggregated/modeled, ARCHITECTURE
// §4). The readings table has no confidence field, so it is documented here
// rather than stored; downstream consumers must treat open-meteo:* stations
// as model data.
//
// Worst case: 4 points × 4 metrics = 16 readings/sync + 1 snapshot row.
// Cadence: medium lane (900s — matches the model's 900s data interval; do not
// poll faster, the 'current' block only refreshes every 15 min).
const META: SourceMeta = {
  slug: 'open-meteo',
  name: 'Open-Meteo Forecast (model)',
  cluster: 'Weather & Atmosphere',
  cadenceSec: 900,
  attribution: 'Weather data by Open-Meteo.com (CC-BY 4.0)',
  licenseNote: 'Free tier is non-commercial only; revisit if BlindSpot is ever commercialized',
};

// Fixed virtual stations (spec): coverage gaps in the real station network.
// We plot the REQUESTED coordinates — the API snaps to its model grid and
// returns slightly different lat/lon, which would jitter the dots.
const POINTS = [
  { id: 'tofino', label: 'Tofino (model)', lat: 49.153, lng: -125.907 },
  { id: 'port-renfrew', label: 'Port Renfrew (model)', lat: 48.555, lng: -124.421 },
  { id: 'port-hardy', label: 'Port Hardy (model)', lat: 50.722, lng: -127.497 },
  { id: 'strait-georgia', label: 'Strait of Georgia mid (model)', lat: 49.3, lng: -123.8 },
] as const;

const FORECAST_URL =
  'https://api.open-meteo.com/v1/forecast' +
  `?latitude=${POINTS.map((p) => p.lat).join(',')}` +
  `&longitude=${POINTS.map((p) => p.lng).join(',')}` +
  '&current=temperature_2m,wind_speed_10m,wind_direction_10m,weather_code,precipitation' +
  '&wind_speed_unit=kn&timeformat=unixtime';

interface OpenMeteoLocation {
  latitude: number;
  longitude: number;
  location_id?: number; // absent on the first element, 1..n-1 on the rest
  current?: {
    time: number; // unix seconds (timeformat=unixtime)
    interval: number; // 900 — the model blend window
    temperature_2m?: number;
    wind_speed_10m?: number;
    wind_direction_10m?: number;
    weather_code?: number; // WMO code — fetched per spec, not yet persisted (Phase 5 tooltips)
    precipitation?: number;
  };
}

// Upstream current field → our metric + honest unit (kn requested → 'kt').
const METRICS: Array<{
  field: 'temperature_2m' | 'wind_speed_10m' | 'wind_direction_10m' | 'precipitation';
  metric: string;
  unit: string;
}> = [
  { field: 'temperature_2m', metric: 'air_temp', unit: '°C' },
  { field: 'wind_speed_10m', metric: 'wind_speed', unit: 'kt' },
  { field: 'wind_direction_10m', metric: 'wind_dir', unit: 'deg' },
  { field: 'precipitation', metric: 'precip', unit: 'mm' },
];

// Snapshot entry shape for the stations layer (stations:<slug> contract).
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
      const res = await fetchSource(FORECAST_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as OpenMeteoLocation[] | OpenMeteoLocation;
      // Multi-coordinate requests return an array; guard the single-object
      // shape anyway in case the batching behavior ever changes.
      const locations = Array.isArray(data) ? data : [data];

      const readings: ReadingInput[] = [];
      const stations: SnapshotStation[] = [];
      locations.forEach((loc, i) => {
        // Array order matches request order; location_id (when present) confirms it.
        const point = POINTS[loc.location_id ?? i];
        const c = loc.current;
        if (!point || !c || !Number.isFinite(c.time)) return;
        const at = c.time * 1000; // unix seconds → ms
        for (const { field, metric, unit } of METRICS) {
          const value = c[field];
          if (typeof value !== 'number' || !Number.isFinite(value)) continue;
          readings.push({
            stationId: `${META.slug}:${point.id}`,
            metric,
            value,
            unit,
            at,
            lat: point.lat,
            lng: point.lng,
            sourceSlug: META.slug,
          });
        }
        // Headline value: air_temp (most legible single number), falling back
        // to wind_speed when the model omits temperature.
        const temp = c.temperature_2m;
        const wind = c.wind_speed_10m;
        stations.push({
          id: point.id,
          label: point.label,
          lat: point.lat,
          lng: point.lng,
          value: typeof temp === 'number' ? temp : typeof wind === 'number' ? wind : null,
          unit: typeof temp === 'number' ? '°C' : 'kt',
          at,
        });
      });

      if (stations.length === 0) throw new Error('no parseable locations in response');
      await ctx.runMutation(internal.feeds.openMeteo.ingest, {
        readings,
        snapshotJson: JSON.stringify(stations),
      });
    } catch (e) {
      await ctx.runMutation(internal.feeds.openMeteo.fail, { error: String(e) });
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
