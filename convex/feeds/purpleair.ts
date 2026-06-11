import { v } from 'convex/values';
import { internalAction, internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { fetchSource } from '../lib/fetchSource';
import { VI_BBOX, inBbox } from '../lib/geo';
import {
  insertReadings,
  reportSuccess,
  reportFailure,
  type ReadingInput,
  type SourceMeta,
} from '../lib/ingest';
import { writeSnapshot } from '../lib/movers';

// purpleair — SOURCES.md: Environment & Conditions. PurpleAir API v1 /sensors,
// community PM2.5 sensors in the VI bbox. NEEDS-KEY: free Read key from the
// Developer Dashboard (https://develop.purpleair.com/), env var PURPLEAIR_KEY —
// until it lands every sync fails cleanly with 'PURPLEAIR_KEY not configured'
// and the source row shows down. That is the expected state for now.
//
// Points economy (the SOURCES gotcha that shapes everything here): the free
// 1M points are a ONE-TIME allocation, not monthly. /sensors costs 5 points
// base + a per-row cost for every requested field, so fields= stays minimal
// (name, latitude, longitude, pm2.5_10minute — the exact set the catalog's
// example endpoint uses) and cadence is the slow lane (1800s). location_type=0
// (outside only) and max_age=3600 (skip sensors silent >1h) are request
// PARAMS, not fields, so they filter server-side at zero per-row cost — both
// per the official API docs; param behavior is not live-verifiable without a
// key. pm2.5_10minute (10-minute average) smooths single-reading spikes.
//
// Keyed response is columnar ({fields: [...], data: [[...]]}) per the docs,
// with sensor_index always prepended to the requested fields — parse by
// header lookup, never fixed positions. Error shape verified live 2026-06-11:
// no key → HTTP 403 {api_version, time_stamp, error: 'ApiKeyMissingError',
// description: 'No API key was found in the request.'}.
//
// Worst case per sync: 150 readings (sensor cap) + 1 snapshot row. All rows
// share at = data_time_stamp (top-level, free) so each poll inserts one
// reading per sensor; 150 × 48 polls/day ≈ 7.2k readings/day worst case —
// real VI density is far lower (Victoria/Nanaimo/Comox clusters per the
// public map).
const META: SourceMeta = {
  slug: 'purpleair',
  name: 'PurpleAir PM2.5',
  cluster: 'Environment & Conditions',
  cadenceSec: 1800,
  attribution: 'PurpleAir',
  licenseNote: 'PurpleAir Data License / ToS — display permitted with attribution',
};

// Sensor cap per spec — keeps the snapshot compact and the per-row point
// spend bounded even if a smoke event lights up every sensor on the Island.
const SENSOR_CAP = 150;

// fields= order here is the request; the response's own fields array is the
// parse contract (sensor_index gets prepended by the API).
const FIELDS = 'name,latitude,longitude,pm2.5_10minute';
const URL =
  `https://api.purpleair.com/v1/sensors?fields=${encodeURIComponent(FIELDS)}` +
  `&location_type=0&max_age=3600` +
  `&nwlng=${VI_BBOX.west}&nwlat=${VI_BBOX.north}&selng=${VI_BBOX.east}&selat=${VI_BBOX.south}`;

// ---- upstream shapes (SOURCES.md documented; keyed shape not yet observed) ----

interface PurpleAirResponse {
  api_version?: string;
  time_stamp?: number; // epoch seconds, server time
  data_time_stamp?: number; // epoch seconds, when the data set was assembled
  fields?: string[]; // e.g. ['sensor_index','name','latitude','longitude','pm2.5_10minute']
  data?: Array<Array<number | string | null>>;
  // error shape (verified live without key)
  error?: string;
  description?: string;
}

interface SnapshotStation {
  id: string;
  label: string;
  lat: number;
  lng: number;
  value: number;
  unit: string;
  at: number;
}

export const sync = internalAction({
  args: {},
  handler: async (ctx) => {
    const key = process.env.PURPLEAIR_KEY;
    if (!key) {
      await ctx.runMutation(internal.feeds.purpleair.fail, {
        error: 'PURPLEAIR_KEY not configured (see PLAN.md keys queue)',
      });
      return;
    }

    try {
      const res = await fetchSource(URL, { headers: { 'X-API-Key': key } });
      let body: PurpleAirResponse | null = null;
      try {
        body = (await res.json()) as PurpleAirResponse;
      } catch {
        // non-JSON handled below
      }
      if (!res.ok) {
        // verified error shape: {error: 'ApiKeyMissingError', description: ...}
        const detail = body?.error
          ? `${body.error}: ${body.description ?? ''}`.trim()
          : `HTTP ${res.status}`;
        throw new Error(detail);
      }
      if (!body || !Array.isArray(body.fields) || !Array.isArray(body.data)) {
        throw new Error('unexpected response shape (no fields/data arrays)');
      }

      // Columnar parse by header lookup — robust to field order and to the
      // API prepending sensor_index.
      const col = (name: string) => body.fields!.indexOf(name);
      const iIdx = col('sensor_index');
      const iName = col('name');
      const iLat = col('latitude');
      const iLng = col('longitude');
      const iPm = col('pm2.5_10minute');
      if (iIdx < 0 || iLat < 0 || iLng < 0 || iPm < 0) {
        throw new Error(`missing expected columns in fields: ${body.fields.join(',')}`);
      }

      // data_time_stamp is when PurpleAir assembled this data set — the best
      // free per-poll observation time (per-sensor last_seen would cost an
      // extra field per row).
      const at = (body.data_time_stamp ?? body.time_stamp ?? Math.floor(Date.now() / 1000)) * 1000;

      const stations: SnapshotStation[] = [];
      for (const row of body.data) {
        const idx = row[iIdx];
        const lat = row[iLat];
        const lng = row[iLng];
        const pm = row[iPm];
        if (typeof idx !== 'number' || typeof lat !== 'number' || typeof lng !== 'number') {
          continue;
        }
        if (typeof pm !== 'number' || !Number.isFinite(pm) || pm < 0) continue; // null/sentinel
        if (!inBbox(lat, lng)) continue; // defensive — bbox already in the query
        const name = row[iName];
        stations.push({
          id: String(idx),
          label: typeof name === 'string' && name ? name : `PurpleAir ${idx}`,
          lat,
          lng,
          value: pm,
          unit: 'µg/m³',
          at,
        });
      }
      // Deterministic cap: stable order by sensor_index, then slice.
      stations.sort((a, b) => Number(a.id) - Number(b.id));
      const capped = stations.slice(0, SENSOR_CAP);

      const readings: ReadingInput[] = capped.map((s) => ({
        stationId: `${META.slug}:${s.id}`,
        metric: 'pm25',
        value: s.value,
        unit: s.unit,
        at: s.at,
        lat: s.lat,
        lng: s.lng,
        sourceSlug: META.slug,
      }));

      // Zero sensors in the bbox window is a valid (if sad) answer, not an
      // error — clean air + offline sensors must not flap the health row.
      await ctx.runMutation(internal.feeds.purpleair.ingest, {
        readings,
        snapshotJson: JSON.stringify(capped),
      });
    } catch (e) {
      await ctx.runMutation(internal.feeds.purpleair.fail, {
        error: String(e instanceof Error ? e.message : e),
      });
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
