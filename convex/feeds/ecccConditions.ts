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

// eccc-conditions — SOURCES.md: Weather & Atmosphere. citypageweather-realtime
// OGC API Features, no auth, CORS *. Per city page: currentConditions →
// air_temp (°C) / humidity (%) / wind_speed (km/h) / pressure (kPa) readings
// plus the stations:eccc-conditions snapshot (headline air_temp) for
// SYSTEM/ENVIRONMENT — no map layer; WX MESH covers map dots.
// Gotcha (catalog): the VI bbox NE corner also matches Sunshine Coast / Metro
// Vancouver / Howe Sound pages — filter by region name to Island communities.
// Shape note (verified live 2026-06-11): every scalar is wrapped in bilingual
// objects ({ value: { en, fr } }), timestamp is { en, fr } ISO strings, and
// `condition` is absent on several pages — only the four metrics are read.
// Worst case: ~21 pages matched, ~14 Island after region filter × 4 metrics
// ≈ 60 readings/sync + 1 snapshot row. Cadence: medium lane (900s; citypage
// conditions refresh roughly hourly).
const META: SourceMeta = {
  slug: 'eccc-conditions',
  name: 'ECCC Current Conditions (citypage)',
  cluster: 'Weather & Atmosphere',
  cadenceSec: 900,
  attribution: 'Data Source: Environment and Climate Change Canada',
};

// Island city pages carry region names like "Greater Victoria",
// "East Vancouver Island - …", "Inland Vancouver Island". Mainland pages in
// the bbox say "Metro Vancouver …", "Sunshine Coast …", "Howe Sound".
const ISLAND_REGION = /Vancouver Island|Greater Victoria/;

interface Bilingual<T = string> {
  en?: T;
  fr?: T;
}

interface Measure {
  value?: Bilingual<number | string>;
  units?: Bilingual;
}

interface CityPageFeature {
  id: string;
  geometry?: { coordinates?: [number, number] };
  properties?: {
    identifier?: string;
    lastUpdated?: string;
    name?: Bilingual;
    region?: Bilingual;
    currentConditions?: {
      timestamp?: Bilingual;
      temperature?: Measure;
      relativeHumidity?: Measure;
      pressure?: Measure;
      wind?: { speed?: Measure };
    };
  };
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

function num(x: number | string | undefined): number | null {
  if (x === undefined || x === null || x === '') return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

export const sync = internalAction({
  args: {},
  handler: async (ctx) => {
    const url =
      'https://api.weather.gc.ca/collections/citypageweather-realtime/items' +
      `?bbox=${VI_BBOX.west},${VI_BBOX.south},${VI_BBOX.east},${VI_BBOX.north}` +
      '&f=json&limit=50';
    try {
      const res = await fetchSource(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { features?: CityPageFeature[] };
      const readings: ReadingInput[] = [];
      const stations: SnapshotStation[] = [];
      for (const f of data.features ?? []) {
        const p = f.properties;
        if (!p || !ISLAND_REGION.test(p.region?.en ?? '')) continue;
        const cc = p.currentConditions;
        const coords = f.geometry?.coordinates;
        if (!cc || !coords) continue;
        const [lng, lat] = coords;
        const at = Date.parse(cc.timestamp?.en ?? p.lastUpdated ?? '');
        if (!Number.isFinite(at)) continue;
        const code = p.identifier ?? f.id; // city code like "bc-75"
        const stationId = `${META.slug}:${code}`;
        // Upstream units (verified live): temperature C, relativeHumidity %,
        // wind.speed km/h, pressure kPa — kept as-is.
        const metrics: Array<{ metric: string; unit: string; value: number | null }> = [
          { metric: 'air_temp', unit: '°C', value: num(cc.temperature?.value?.en) },
          { metric: 'humidity', unit: '%', value: num(cc.relativeHumidity?.value?.en) },
          { metric: 'wind_speed', unit: 'km/h', value: num(cc.wind?.speed?.value?.en) },
          { metric: 'pressure', unit: 'kPa', value: num(cc.pressure?.value?.en) },
        ];
        for (const { metric, unit, value } of metrics) {
          if (value === null) continue; // only metrics present per page
          readings.push({ stationId, metric, value, unit, at, lat, lng, sourceSlug: META.slug });
        }
        stations.push({
          id: code,
          label: p.name?.en ?? code,
          lat,
          lng,
          value: num(cc.temperature?.value?.en), // headline: air_temp (spec)
          unit: '°C',
          at,
        });
      }
      if (stations.length === 0) throw new Error('no Island city pages with conditions in bbox');
      await ctx.runMutation(internal.feeds.ecccConditions.ingest, {
        readings,
        snapshotJson: JSON.stringify(stations),
      });
    } catch (e) {
      await ctx.runMutation(internal.feeds.ecccConditions.fail, { error: String(e) });
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
