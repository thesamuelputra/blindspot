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

// openaq — SOURCES.md: Environment & Conditions. OpenAQ API v3, normalized
// PM2.5/O3 from the government monitors on VI (for VI these are the same
// ECCC/BC ENV stations as bc-aqhi — this module is the normalized-µg/m³
// fallback layer, per the catalog gotcha; bc-aqhi stays the AQHI authority).
// NEEDS-KEY: free key via https://explore.openaq.org/register, env var
// OPENAQ_KEY in the X-API-Key header — until it lands every sync fails
// cleanly with 'OPENAQ_KEY not configured' and the source row shows down.
//
// Two-step v3 flow (documented shape, not observable without a key):
//   1. GET /v3/locations?bbox=west,south,east,north — the catalog example
//      uses coordinates+radius, but radius maxes at 25km (one city); the
//      documented bbox param covers the whole Island in one call.
//   2. GET /v3/locations/{id}/latest per kept location — rows are
//      {datetime:{utc}, value, sensorsId, locationsId}; map sensorsId back
//      to a parameter via the location's sensors array.
// Calls are sequential: ≤ LOCATION_CAP+1 requests/sync, well inside the
// 60/min / 2,000/hr free-tier limits at the 1800s cadence.
//
// Error shape verified live 2026-06-11: no key → HTTP 401
// {message: 'Unauthorized. A valid API key must be provided in the
// X-API-Key header.'}.
//
// Known OpenAQ quirks guarded here: negative sentinel values (e.g. -999)
// on broken monitors are skipped; latest rows older than MAX_AGE_MS
// (defunct stations keep their last value forever) are skipped.
//
// Worst case per sync: LOCATION_CAP locations × 2 metrics = 80 readings +
// 1 snapshot row; realistically VI hosts ~10-20 government monitors.
const META: SourceMeta = {
  slug: 'openaq',
  name: 'OpenAQ Monitors',
  cluster: 'Environment & Conditions',
  cadenceSec: 1800,
  attribution: 'OpenAQ / Environment and Climate Change Canada & BC ENV',
  licenseNote: 'OpenAQ platform; underlying government data CC BY 4.0',
};

const API = 'https://api.openaq.org/v3';
const LOCATIONS_URL =
  `${API}/locations?bbox=${VI_BBOX.west},${VI_BBOX.south},${VI_BBOX.east},${VI_BBOX.north}` +
  `&limit=1000`;

// Parameters we ingest, keyed by OpenAQ parameter.name → our metric.
const METRICS: Record<string, string> = { pm25: 'pm25', o3: 'o3' };

// Request-count guard (rate limits) and snapshot-size guard.
const LOCATION_CAP = 40;

// Hourly government monitors: anything older than 6h is a dead/lagging
// station, not current air quality — keep it out of readings and the map.
const MAX_AGE_MS = 6 * 3600 * 1000;

// ---- upstream shapes (docs.openaq.org v3; keyed shape not yet observed) ----

interface OaqSensor {
  id?: number;
  parameter?: { id?: number; name?: string; units?: string; displayName?: string };
}

interface OaqLocation {
  id?: number;
  name?: string;
  coordinates?: { latitude?: number; longitude?: number };
  sensors?: OaqSensor[];
}

interface OaqLatestRow {
  datetime?: { utc?: string; local?: string };
  value?: number;
  sensorsId?: number;
  locationsId?: number;
}

interface OaqList<T> {
  meta?: { found?: number | string };
  results?: T[];
  // 401 shape (verified live without key)
  message?: string;
}

async function oaqJson<T>(url: string, key: string, label: string): Promise<OaqList<T>> {
  const res = await fetchSource(url, { headers: { 'X-API-Key': key } });
  let body: OaqList<T> | null = null;
  try {
    body = (await res.json()) as OaqList<T>;
  } catch {
    // non-JSON handled below
  }
  if (!res.ok) {
    // verified error shape: {message: 'Unauthorized. ...'}
    throw new Error(`${label}: ${body?.message ?? `HTTP ${res.status}`}`);
  }
  if (!body) throw new Error(`${label}: non-JSON response`);
  return body;
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
    const key = process.env.OPENAQ_KEY;
    if (!key) {
      await ctx.runMutation(internal.feeds.openaq.fail, {
        error: 'OPENAQ_KEY not configured (see PLAN.md keys queue)',
      });
      return;
    }

    try {
      const list = await oaqJson<OaqLocation>(LOCATIONS_URL, key, 'locations');

      // Keep only stations that carry a parameter we ingest, inside the VI
      // bbox (defensive — bbox already in the query), capped for rate limits.
      const kept: Array<{
        id: number;
        label: string;
        lat: number;
        lng: number;
        sensorParam: Map<number, { metric: string; unit: string }>;
      }> = [];
      for (const loc of list.results ?? []) {
        const lat = loc.coordinates?.latitude;
        const lng = loc.coordinates?.longitude;
        if (typeof loc.id !== 'number' || typeof lat !== 'number' || typeof lng !== 'number') {
          continue;
        }
        if (!inBbox(lat, lng)) continue;
        const sensorParam = new Map<number, { metric: string; unit: string }>();
        for (const s of loc.sensors ?? []) {
          const pname = s.parameter?.name ?? '';
          const metric = METRICS[pname];
          if (typeof s.id === 'number' && metric) {
            sensorParam.set(s.id, { metric, unit: s.parameter?.units ?? '' });
          }
        }
        if (sensorParam.size === 0) continue;
        kept.push({ id: loc.id, label: loc.name ?? `OpenAQ ${loc.id}`, lat, lng, sensorParam });
        if (kept.length >= LOCATION_CAP) break;
      }

      const now = Date.now();
      const readings: ReadingInput[] = [];
      const stations: SnapshotStation[] = [];
      const errors: string[] = [];

      // Sequential on purpose: polite pacing under the 60/min limit.
      for (const loc of kept) {
        let latest: OaqList<OaqLatestRow>;
        try {
          latest = await oaqJson<OaqLatestRow>(
            `${API}/locations/${loc.id}/latest`,
            key,
            `latest ${loc.id}`,
          );
        } catch (e) {
          errors.push(String(e instanceof Error ? e.message : e));
          continue;
        }
        // Freshest good row per metric (a location can list multiple sensors
        // for the same parameter).
        const byMetric = new Map<string, { value: number; unit: string; at: number }>();
        for (const row of latest.results ?? []) {
          if (typeof row.sensorsId !== 'number') continue;
          const mapped = loc.sensorParam.get(row.sensorsId);
          if (!mapped) continue;
          if (typeof row.value !== 'number' || !Number.isFinite(row.value) || row.value < 0) {
            continue; // negative sentinels (-999) on broken monitors
          }
          const at = Date.parse(row.datetime?.utc ?? '');
          if (!Number.isFinite(at) || now - at > MAX_AGE_MS) continue; // stale/defunct
          const prev = byMetric.get(mapped.metric);
          if (prev && prev.at >= at) continue;
          byMetric.set(mapped.metric, { value: row.value, unit: mapped.unit, at });
        }
        for (const [metric, m] of byMetric) {
          readings.push({
            stationId: `${META.slug}:${loc.id}`,
            metric,
            value: m.value,
            unit: m.unit,
            at: m.at,
            lat: loc.lat,
            lng: loc.lng,
            sourceSlug: META.slug,
          });
        }
        // Headline dot value: pm25 first (the layer vocabulary), o3 fallback.
        const headline = byMetric.get('pm25') ?? byMetric.get('o3');
        if (headline) {
          stations.push({
            id: String(loc.id),
            label: loc.label,
            lat: loc.lat,
            lng: loc.lng,
            value: headline.value,
            unit: headline.unit,
            at: headline.at,
          });
        }
      }

      // Zero stations with every per-location call succeeding = genuinely no
      // fresh data (valid); zero stations because calls failed = failure.
      if (stations.length === 0 && errors.length > 0) {
        throw new Error(errors.join('; '));
      }
      await ctx.runMutation(internal.feeds.openaq.ingest, {
        readings,
        snapshotJson: JSON.stringify(stations),
      });
    } catch (e) {
      await ctx.runMutation(internal.feeds.openaq.fail, {
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
