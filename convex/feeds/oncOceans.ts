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

// onc-oceans3 — SOURCES.md: Seismic & Tsunami (also catalogued under Seas).
// Ocean Networks Canada Oceans 3.0 scalardata API. NEEDS-KEY: free token via
// Oceans 3.0 account (Profile → Web Services API tab), env var ONC_TOKEN —
// until it lands every sync fails cleanly with 'ONC_TOKEN not configured' and
// the source row shows down. That is the expected state for now.
//
// Per location we hit /api/scalardata/location with getLatest=true (tiny
// responses, per SOURCES rate-limit note) for deviceCategoryCode=CTD — the
// category documented in the catalog's own example endpoint — which carries
// both a pressure sensor (decibar → metric 'seafloor_pressure', unit 'dbar')
// and a temperature sensor (°C → metric 'water_temp'). Seafloor pressure is
// the offshore tsunami signal the fusion rule wants (PLAN.md).
//
// Coordinates are NOT hardcoded: the catalog gotcha says location codes and
// metadata must be resolved via /api/locations, so each sync resolves
// lat/lon per locationCode from the API (one extra cheap call per location).
// Error shapes verified live 2026-06-11: missing token → HTTP 401
// {errors:[{errorCode:128,errorMessage:'Either token or appToken must be
// specified.',parameter:'token, appToken'}]}; invalid token → HTTP 401
// errorCode 127 'Invalid parameter value' (parameter:'token').
//
// Worst case: 3 locations × 2 metrics = 6 readings/sync + 1 snapshot row.
// Cadence: medium lane (600s; catalog says 5 min with getLatest is polite).
const META: SourceMeta = {
  slug: 'onc-oceans3',
  name: 'ONC Oceans 3.0 (seafloor)',
  cluster: 'Seismic & Tsunami',
  cadenceSec: 600,
  attribution: 'Ocean Networks Canada',
  licenseNote: 'ONC Data Policy (CC BY 4.0) — citation of Ocean Networks Canada required',
};

const API = 'https://data.oceannetworks.ca/api';

// Candidate VI-relevant instruments per the SOURCES entry. BACAX is the one
// code the catalog documents explicitly (its own example endpoint). FGPD
// (Folger Passage - Folger Deep) and SCVIP (Saanich Inlet - VENUS Instrument
// Platform) cover the two observatories the catalog names; the codes
// themselves are NOT in the catalog and must be confirmed against
// /api/locations once the token lands (SOURCES gotcha: never trust memory).
// Wrong codes degrade gracefully: that location errors per-sync, the rest
// keep flowing, and the joined error is visible on the source row.
const LOCATIONS = [
  { code: 'FGPD', fallbackLabel: 'Folger Deep (Barkley Sound)' },
  { code: 'SCVIP', fallbackLabel: 'Saanich Inlet (VENUS)' },
  { code: 'BACAX', fallbackLabel: 'Barkley Canyon Axis' },
] as const;

const DEVICE_CATEGORY = 'CTD';

// ---- upstream shapes (per SOURCES.md / ONC client-library docs) ----

interface OncError {
  errorCode?: number;
  errorMessage?: string;
  parameter?: string;
}

interface OncSensorData {
  sensorCode?: string;
  sensorName?: string;
  sensorCategoryCode?: string;
  propertyCode?: string;
  unitOfMeasure?: string;
  data?: {
    sampleTimes?: string[]; // ISO, e.g. '2026-06-11T14:00:00.000Z'
    values?: Array<number | null>;
    qaqcFlags?: number[];
  } | null;
}

interface OncScalarResponse {
  sensorData?: OncSensorData[] | null; // null when no data in window
  errors?: OncError[];
}

interface OncLocation {
  locationCode?: string;
  locationName?: string;
  lat?: number;
  lon?: number;
}

// Surface ONC's structured error array as a readable message (verified shape).
async function oncJson<T>(url: string, label: string): Promise<T> {
  const res = await fetchSource(url);
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // fall through — non-JSON body handled below
  }
  if (!res.ok) {
    const errs = (body as { errors?: OncError[] } | null)?.errors;
    const detail = errs?.length
      ? errs.map((e) => `${e.errorMessage ?? 'error'} (${e.parameter ?? `code ${e.errorCode}`})`).join('; ')
      : `HTTP ${res.status}`;
    throw new Error(`${label}: ${detail}`);
  }
  if (body === null) throw new Error(`${label}: non-JSON response`);
  return body as T;
}

// Map a CTD sensor onto our metric vocabulary; null = sensor we don't ingest.
// Prefer the stable propertyCode/sensorCategoryCode, fall back to name/unit.
function metricFor(s: OncSensorData): { metric: string; unit: string } | null {
  const prop = (s.propertyCode ?? s.sensorCategoryCode ?? '').toLowerCase();
  const name = (s.sensorName ?? s.sensorCode ?? '').toLowerCase();
  const uom = (s.unitOfMeasure ?? '').toLowerCase();
  if (prop.includes('pressure') || (name.includes('pressure') && uom.includes('decibar'))) {
    return { metric: 'seafloor_pressure', unit: 'dbar' };
  }
  if (
    prop === 'seawatertemperature' ||
    prop === 'temperature' ||
    (name.includes('temperature') && !name.includes('internal'))
  ) {
    return { metric: 'water_temp', unit: '°C' };
  }
  return null;
}

// Newest sample with a finite value that did not fail QAQC (flag 4 = fail in
// ONC's scheme; 0 = untested and low flags pass through).
function latestGood(d: NonNullable<OncSensorData['data']>): { at: number; value: number } | null {
  const times = d.sampleTimes ?? [];
  const values = d.values ?? [];
  const flags = d.qaqcFlags ?? [];
  let best: { at: number; value: number } | null = null;
  for (let i = 0; i < times.length; i++) {
    const at = Date.parse(times[i]);
    const value = values[i];
    if (!Number.isFinite(at) || typeof value !== 'number' || !Number.isFinite(value)) continue;
    if (flags[i] === 4) continue;
    if (!best || at > best.at) best = { at, value };
  }
  return best;
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
    const token = process.env.ONC_TOKEN;
    if (!token) {
      await ctx.runMutation(internal.feeds.oncOceans.fail, {
        error: 'ONC_TOKEN not configured (see PLAN.md keys queue)',
      });
      return;
    }

    const readings: ReadingInput[] = [];
    const stations: SnapshotStation[] = [];
    const errors: string[] = [];

    const results = await Promise.allSettled(
      LOCATIONS.map(async (loc) => {
        // 1. Resolve authoritative metadata (gotcha: never hardcode coords).
        const locBody = await oncJson<OncLocation[]>(
          `${API}/locations?method=get&locationCode=${loc.code}&token=${token}`,
          `${loc.code} locations`,
        );
        const meta = Array.isArray(locBody) ? locBody[0] : undefined;
        const lat = meta?.lat;
        let lng = meta?.lon;
        if (typeof lng === 'number' && lng > 180) lng -= 360; // degrees-east guard
        if (typeof lat !== 'number' || typeof lng !== 'number') {
          throw new Error(`${loc.code}: no lat/lon in /api/locations response`);
        }
        // 2. Latest CTD scalars at this location.
        const scalar = await oncJson<OncScalarResponse>(
          `${API}/scalardata/location?locationCode=${loc.code}&deviceCategoryCode=${DEVICE_CATEGORY}` +
            `&getLatest=true&rowLimit=10&token=${token}`,
          `${loc.code} scalardata`,
        );
        return {
          loc,
          lat,
          lng,
          label: meta?.locationName ?? loc.fallbackLabel,
          sensors: scalar.sensorData ?? [],
        };
      }),
    );

    for (const r of results) {
      if (r.status === 'rejected') {
        errors.push(String(r.reason instanceof Error ? r.reason.message : r.reason));
        continue;
      }
      const { loc, lat, lng, label, sensors } = r.value;
      const byMetric = new Map<string, { value: number; unit: string; at: number }>();
      for (const s of sensors) {
        const mapped = metricFor(s);
        if (!mapped || !s.data) continue;
        const sample = latestGood(s.data);
        if (!sample) continue;
        const prev = byMetric.get(mapped.metric);
        if (prev && prev.at >= sample.at) continue; // keep freshest per metric
        byMetric.set(mapped.metric, { value: sample.value, unit: mapped.unit, at: sample.at });
      }
      if (byMetric.size === 0) {
        errors.push(`${loc.code}: no ingestible CTD sensors in window`);
        continue;
      }
      for (const [metric, m] of byMetric) {
        readings.push({
          stationId: `onc:${loc.code}`,
          metric,
          value: m.value,
          unit: m.unit,
          at: m.at,
          lat,
          lng,
          sourceSlug: META.slug,
        });
      }
      // Headline dot value: water_temp (human-readable), falling back to
      // seafloor_pressure; the tsunami fusion rule reads the readings series,
      // not this snapshot.
      const headline = byMetric.get('water_temp') ?? byMetric.get('seafloor_pressure');
      if (headline) {
        stations.push({
          id: loc.code,
          label,
          lat,
          lng,
          value: headline.value,
          unit: headline.unit,
          at: headline.at,
        });
      }
    }

    // Partial success is success; only an all-locations wipeout marks the
    // source stale/down (mirrors dfoTides/ndbcBuoys).
    if (stations.length === 0) {
      await ctx.runMutation(internal.feeds.oncOceans.fail, {
        error: errors.join('; ') || 'no scalar data returned',
      });
      return;
    }
    await ctx.runMutation(internal.feeds.oncOceans.ingest, {
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
