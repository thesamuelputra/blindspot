import { v } from 'convex/values';
import { internalAction, internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { fetchSource } from '../lib/fetchSource';
import { parseXml } from '../lib/xml';
import { writeSnapshot } from '../lib/movers';
import {
  insertReadings,
  reportSuccess,
  reportFailure,
  type ReadingInput,
  type SourceMeta,
} from '../lib/ingest';

// uvic-weather-mesh — SOURCES.md: Weather & Atmosphere. UVic school-based
// weather station network, per-station XML at
// https://www.victoriaweather.ca/stations/{slug}/current.xml (no auth).
// Curated subset only — NEVER sweep all ~190 stations; volunteer-run single
// Apache box, fetched sequentially to stay gentle. Worst case 13 stations ×
// 6 metrics = 78 readings/sync. Cadence: medium lane (600s).
//
// Verified live 2026-06-11. Gotchas confirmed by probe:
// 1) longitude is degrees EAST 0–360 (UVicSci = 236.69 → -123.31): subtract
//    360 when > 180 or markers land in China.
// 2) observation_time is local Pacific with no offset ('2026/06/11, 07:38');
//    parsed with an explicit -07:00 offset per SOURCES.md.
// 3) Stations return HTTP 200 with <station_fault>/<error_message> and NO
//    observation block when down — a 200 is not data; skip, don't fail.
// 4) Partial sensor faults are common: observation present but individual
//    elements absent (e.g. temperature missing while pressure/wind live).
const META: SourceMeta = {
  slug: 'uvic-weather-mesh',
  name: 'UVic Weather Mesh (victoriaweather.ca)',
  cluster: 'Weather & Atmosphere',
  cadenceSec: 600,
  attribution: 'Vancouver Island School-Based Weather Station Network · victoriaweather.ca',
  licenseNote: 'CC BY-NC-SA 4.0 - non-commercial; email weather@uvic.ca per their request',
};

// Curated island-spanning subset. Every slug verified 200 via curl on
// 2026-06-11; "no data" = station_fault/error_message at verification, kept
// for geographic coverage when the sensor returns (the loop skips them).
const STATIONS = [
  'UVicSci', // Victoria — full observation
  'Colwood', // Westshore — live
  'Brentwood', // Brentwood Bay — thermometer faulted; pressure/wind/rain live
  'NorthSaanich', // Saanich Peninsula — live
  'DeepCove', // North Saanich — temp/humidity faulted; rest live
  'ShawniganLake', // Shawnigan Lake — live
  'VIU', // Nanaimo — live
  'QualicumElementary', // Qualicum Beach — live, no temperature element
  'Airport', // Comox — temp/humidity faulted; rest live
  'WillowPoint', // Campbell River — live, partial
  'Cortes', // Cortes Island — live, partial
  'Ucluelet', // West coast — no data at verification
  'BamfieldMarine', // Bamfield — no data at verification
] as const;

const BASE = 'https://www.victoriaweather.ca/stations';

// fast-xml-parser coerces numeric element text to numbers; faulted stations
// simply omit elements, so everything is optional.
interface UvicObservation {
  station_long_name?: string;
  station_name?: string | number;
  latitude?: number | string;
  longitude?: number | string;
  observation_time?: string;
  station_fault?: string;
  error_message?: string;
  temperature?: number | string;
  humidity?: number | string;
  pressure?: number | string;
  rain_rate?: number | string;
  wind_speed?: number | string;
  wind_speed_direction?: number | string;
}

interface SnapshotStation {
  id: string;
  label: string;
  lat: number;
  lng: number;
  value: number | null; // headline air_temp; null when thermometer is faulted
  unit: string;
  at: number;
}

function num(x: unknown): number | undefined {
  if (typeof x === 'number' && Number.isFinite(x)) return x;
  if (typeof x === 'string') {
    const n = parseFloat(x);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

// '2026/06/11, 07:38' local Pacific — SOURCES.md says parse with an explicit
// -07:00 offset (no UTC offset upstream).
function parseObservedAt(s: string): number | null {
  const m = /^(\d{4})\/(\d{2})\/(\d{2}),?\s+(\d{1,2}):(\d{2})/.exec(s.trim());
  if (!m) return null;
  const t = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4].padStart(2, '0')}:${m[5]}:00-07:00`);
  return Number.isNaN(t) ? null : t;
}

export const sync = internalAction({
  args: {},
  handler: async (ctx) => {
    const readings: ReadingInput[] = [];
    const snapshot: SnapshotStation[] = [];
    let okFetches = 0;
    let lastError = 'no station reachable';

    // Sequential on purpose — single volunteer-run server, be gentle.
    for (const slug of STATIONS) {
      try {
        const res = await fetchSource(`${BASE}/${slug}/current.xml`, {
          retries: 0,
          timeoutMs: 10_000,
        });
        if (!res.ok) {
          lastError = `HTTP ${res.status} for ${slug}`;
          continue;
        }
        okFetches++;
        const doc = parseXml(await res.text()) as { current_observation?: UvicObservation };
        const obs = doc.current_observation;
        // Faulted station: 200 + error_message, no observation. Skip quietly.
        if (!obs || obs.error_message !== undefined || obs.observation_time === undefined) {
          continue;
        }
        const lat = num(obs.latitude);
        const lngEast = num(obs.longitude);
        const at = parseObservedAt(String(obs.observation_time));
        if (lat === undefined || lngEast === undefined || at === null) continue;
        // Longitude is degrees EAST 0–360 — convert to signed west.
        const lng = lngEast > 180 ? lngEast - 360 : lngEast;

        const stationId = `${META.slug}:${slug}`;
        const metrics: Array<[string, number | undefined, string]> = [
          ['air_temp', num(obs.temperature), '°C'],
          ['humidity', num(obs.humidity), '%'],
          ['wind_speed', num(obs.wind_speed), 'km/h'],
          ['wind_dir', num(obs.wind_speed_direction), '°'],
          ['rain_rate', num(obs.rain_rate), 'mm/h'],
          ['pressure', num(obs.pressure), 'hPa'],
        ];
        for (const [metric, value, unit] of metrics) {
          if (value !== undefined) {
            readings.push({ stationId, metric, value, unit, at, lat, lng, sourceSlug: META.slug });
          }
        }
        snapshot.push({
          id: slug,
          label:
            typeof obs.station_long_name === 'string' ? obs.station_long_name : String(slug),
          lat,
          lng,
          value: num(obs.temperature) ?? null,
          unit: '°C',
          at,
        });
      } catch (e) {
        lastError = String(e);
      }
    }

    if (okFetches === 0) {
      await ctx.runMutation(internal.feeds.uvicMesh.fail, { error: lastError });
      return;
    }
    await ctx.runMutation(internal.feeds.uvicMesh.ingest, {
      readings,
      snapshot: JSON.stringify(snapshot),
    });
  },
});

export const ingest = internalMutation({
  args: { readings: v.array(v.any()), snapshot: v.string() },
  handler: async (ctx, { readings, snapshot }) => {
    const inserted = await insertReadings(ctx, readings as ReadingInput[]);
    await writeSnapshot(ctx, 'stations:uvic-weather-mesh', snapshot);
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
