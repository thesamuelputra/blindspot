import { v } from 'convex/values';
import { internalAction, internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { fetchSource } from '../lib/fetchSource';
import { VI_BBOX } from '../lib/geo';
import {
  insertReadings,
  reportSuccess,
  reportFailure,
  type ReadingInput,
  type SourceMeta,
} from '../lib/ingest';
import { writeSnapshot } from '../lib/movers';

// bc-aqhi — SOURCES.md: Environment & Conditions. ECCC AQHI observations +
// forecasts on api.weather.gc.ca (OGC API Features), no auth, hourly product.
// NOTE: SOURCES.md carries a duplicate of this source as `eccc-aqhi-realtime`
// (Weather & Atmosphere); this module implements the richer T1 `bc-aqhi`
// entry, which documents latest=true and the forecasts collection.
// Worst case per sync: 8 observation rows in bbox (5 Island communities after
// the lng filter) + one 500-row forecast page (~250 KB; a single publication
// is 8 communities × 38 hourly steps + 1 period-summary row = 304 features).
// Readings written ≤ ~130 on a fresh hour, near-zero between publications
// (insertReadings dedupes on stationId/metric/at). Cadence: medium (900s).
const META: SourceMeta = {
  slug: 'bc-aqhi',
  name: 'ECCC Air Quality Health Index',
  cluster: 'Environment & Conditions',
  cadenceSec: 900,
  attribution: 'Data Source: Environment and Climate Change Canada',
};

const BBOX = `${VI_BBOX.west},${VI_BBOX.south},${VI_BBOX.east},${VI_BBOX.north}`;
// latest=true works on observations only (verified live 2026-06-11) and
// collapses history to one row per community.
const OBS_URL = `https://api.weather.gc.ca/collections/aqhi-observations-realtime/items?f=json&bbox=${BBOX}&latest=true&limit=50`;
// Forecasts have no `latest` property — sort by publication and pick the
// newest batch per community. limit=500 because one publication alone is
// ~304 rows; SOURCES.md's limit=100 truncates entire communities.
const FCST_URL = `https://api.weather.gc.ca/collections/aqhi-forecasts-realtime/items?f=json&bbox=${BBOX}&limit=500&sortby=-publication_datetime`;

// The VI bbox NE corner overlaps the mainland (Metro Vancouver NW/SW,
// Squamish). Island communities (Victoria/Saanich JBOBQ, WestShore JCLMX,
// Duncan JBBWA, Nanaimo/Parksville JAQAL, Comox Valley JAHJY) all sit west
// of -123.3 (SOURCES.md gotcha) — filter by longitude, not a hardcoded id
// list, so new Island communities (e.g. a future Port Alberni) appear free.
const ISLAND_MAX_LNG = -123.3;

// Store forecast steps for the next 24h only — the hourly steps run ~36h out
// and the far tail has little console value.
const FORECAST_HORIZON_MS = 24 * 3600 * 1000;

interface AqhiFeature {
  geometry: { type: string; coordinates: [number, number] } | null;
  properties: {
    location_id: string;
    location_name_en: string;
    aqhi?: number | null; // float on observations, int on forecast steps
    observation_datetime?: string;
    forecast_datetime?: string; // absent on AQHI-Forecast-Period summary rows
    publication_datetime?: string;
    aqhi_type?: string;
  };
}

interface Station {
  id: string;
  label: string;
  lat: number;
  lng: number;
  value: number;
  at: number;
}

export const sync = internalAction({
  args: {},
  handler: async (ctx) => {
    try {
      const res = await fetchSource(OBS_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status} (observations)`);
      const obs = (await res.json()) as { features?: AqhiFeature[] };

      // latest=true already dedupes; keep a newest-wins pass per community as
      // a guard in case upstream ever returns history rows anyway.
      const byLoc = new Map<string, Station>();
      for (const f of obs.features ?? []) {
        const p = f.properties;
        const coords = f.geometry?.coordinates;
        if (!coords || typeof p.aqhi !== 'number' || !p.observation_datetime) continue;
        const [lng, lat] = coords;
        if (lng >= ISLAND_MAX_LNG) continue; // mainland station in bbox corner
        const at = Date.parse(p.observation_datetime);
        if (!Number.isFinite(at)) continue;
        const prev = byLoc.get(p.location_id);
        if (!prev || at > prev.at) {
          byLoc.set(p.location_id, {
            id: p.location_id,
            label: p.location_name_en,
            lat,
            lng,
            value: p.aqhi,
            at,
          });
        }
      }
      const stations = [...byLoc.values()];

      const readings: ReadingInput[] = stations.map((s) => ({
        stationId: `${META.slug}:${s.id}`,
        metric: 'aqhi',
        value: s.value,
        unit: 'index',
        at: s.at,
        lat: s.lat,
        lng: s.lng,
        sourceSlug: META.slug,
      }));

      // Forecasts are enrichment — a failure here must not sink the obs sync.
      try {
        readings.push(...(await fetchForecasts()));
      } catch {
        // hourly product; the next tick retries
      }

      const snapshot = JSON.stringify(
        stations.map((s) => ({
          id: s.id,
          label: s.label,
          lat: s.lat,
          lng: s.lng,
          value: s.value,
          unit: 'index',
          at: s.at,
        })),
      );
      await ctx.runMutation(internal.feeds.ecccAqhi.ingest, {
        readings,
        snapshot,
        stationCount: stations.length,
      });
    } catch (e) {
      await ctx.runMutation(internal.feeds.ecccAqhi.fail, { error: String(e) });
    }
  },
});

async function fetchForecasts(): Promise<ReadingInput[]> {
  const res = await fetchSource(FCST_URL, { retries: 0 });
  if (!res.ok) throw new Error(`HTTP ${res.status} (forecasts)`);
  const data = (await res.json()) as { features?: AqhiFeature[] };
  const now = Date.now();

  // Newest publication per community wins; the descending sort guarantees the
  // newest batch sits inside the 500-row page.
  const newestPub = new Map<string, number>();
  for (const f of data.features ?? []) {
    const pub = Date.parse(f.properties.publication_datetime ?? '');
    if (!Number.isFinite(pub)) continue;
    if (pub > (newestPub.get(f.properties.location_id) ?? 0)) {
      newestPub.set(f.properties.location_id, pub);
    }
  }

  const out = new Map<string, ReadingInput>(); // key: location|forecast time
  for (const f of data.features ?? []) {
    const p = f.properties;
    const coords = f.geometry?.coordinates;
    // Also skips AQHI-Forecast-Period summary rows (nested forecast_period
    // object, no top-level aqhi/forecast_datetime — seen live 2026-06-11).
    if (!coords || typeof p.aqhi !== 'number' || !p.forecast_datetime) continue;
    const [lng, lat] = coords;
    if (lng >= ISLAND_MAX_LNG) continue;
    if (Date.parse(p.publication_datetime ?? '') !== newestPub.get(p.location_id)) continue;
    const at = Date.parse(p.forecast_datetime);
    if (!Number.isFinite(at) || at <= now || at > now + FORECAST_HORIZON_MS) continue;
    const key = `${p.location_id}|${at}`;
    // First feature wins per slot; insertReadings keeps the first value for a
    // given (station, metric, at) anyway, so amended forecasts do not rewrite
    // history — conservative by contract.
    if (!out.has(key)) {
      out.set(key, {
        stationId: `${META.slug}:${p.location_id}`,
        metric: 'aqhi_forecast',
        value: p.aqhi,
        unit: 'index',
        at,
        lat,
        lng,
        sourceSlug: META.slug,
      });
    }
  }
  return [...out.values()];
}

export const ingest = internalMutation({
  args: { readings: v.array(v.any()), snapshot: v.string(), stationCount: v.number() },
  handler: async (ctx, { readings, snapshot, stationCount }) => {
    const inserted = await insertReadings(ctx, readings as ReadingInput[]);
    // Snapshot key fixed by the layer spec ('stations:eccc-aqhi'); kept stable
    // even though the SOURCES.md slug for this module is bc-aqhi.
    await writeSnapshot(ctx, 'stations:eccc-aqhi', snapshot);
    await reportSuccess(ctx, META, stationCount);
    return { inserted };
  },
});

export const fail = internalMutation({
  args: { error: v.string() },
  handler: async (ctx, { error }) => {
    await reportFailure(ctx, META, error);
  },
});
