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

// eccc-hydrometric (SOURCES.md: Infrastructure / Network / Cyber). MSC GeoMet
// OGC API Features, hydrometric-realtime collection, no auth. One request per
// station: comma separated STATION_NUMBER returns numberMatched 0 (verified
// live 2026-06-11), and bbox queries return one feature per 5-min timestamp
// (huge counts), so we poll each station with sortby=-DATETIME and a small
// limit per the catalog gotchas. Worst case 9 stations x 2 metrics = 18
// readings per sync plus one 9-entry snapshot. Cadence: medium lane (900s);
// readings are 5-min but DataMart ingestion batches roughly hourly.
const META: SourceMeta = {
  slug: 'eccc-hydrometric',
  name: 'ECCC Hydrometric (Water Survey of Canada)',
  cluster: 'Infrastructure / Network / Cyber',
  cadenceSec: 900,
  attribution: 'Data source: Environment and Climate Change Canada / Water Survey of Canada',
};

// VI river stations from the SOURCES.md catalog (all 9 verified live
// 2026-06-11, every one reporting LEVEL; DISCHARGE null on 08HB011 Tsolum).
// Coordinates come from each feature's geometry, not hardcoded here.
const STATIONS: Array<{ id: string; label: string }> = [
  { id: '08HA011', label: 'Cowichan @ Duncan' },
  { id: '08HA002', label: 'Cowichan @ Lake Cowichan' },
  { id: '08HA003', label: 'Koksilah' },
  { id: '08HB002', label: 'Englishman' },
  { id: '08HB006', label: 'Puntledge @ Courtenay' },
  { id: '08HB084', label: 'Puntledge blw Diversion' },
  { id: '08HB011', label: 'Tsolum' },
  { id: '08HB017', label: 'Somass' },
  { id: '08HD011', label: 'Oyster' },
];

interface HydroFeature {
  geometry: { coordinates: [number, number] };
  properties: {
    STATION_NUMBER: string;
    STATION_NAME: string;
    DATETIME: string; // UTC ISO, e.g. "2026-06-11T14:20:00Z"
    LEVEL: number | null; // m
    DISCHARGE: number | null; // m3/s
  };
}

// Snapshot entry shape for the rivers layer (stations:<slug> contract):
// headline value is water_level in metres.
interface StationDot {
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
    // limit=6 covers ~30 min of 5-min records so a null latest LEVEL or
    // DISCHARGE can fall back to the most recent non-null reading.
    const results = await Promise.allSettled(
      STATIONS.map(async (st) => {
        const url =
          'https://api.weather.gc.ca/collections/hydrometric-realtime/items' +
          `?STATION_NUMBER=${st.id}&f=json&limit=6&sortby=-DATETIME`;
        const res = await fetchSource(url);
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${st.id}`);
        const data = (await res.json()) as { features?: HydroFeature[] };
        return { station: st, features: data.features ?? [] };
      }),
    );

    const readings: ReadingInput[] = [];
    const dots: StationDot[] = [];
    let lastError = '';
    let reachable = 0;

    for (const r of results) {
      if (r.status === 'rejected') {
        lastError = String(r.reason);
        continue;
      }
      reachable++;
      const { station, features } = r.value;
      // features arrive newest-first (sortby=-DATETIME)
      const latestLevel = features.find((f) => f.properties.LEVEL !== null);
      const latestDischarge = features.find((f) => f.properties.DISCHARGE !== null);

      if (latestLevel) {
        const [lng, lat] = latestLevel.geometry.coordinates;
        const at = Date.parse(latestLevel.properties.DATETIME);
        readings.push({
          stationId: `${META.slug}:${station.id}`,
          metric: 'water_level',
          value: latestLevel.properties.LEVEL!,
          unit: 'm',
          at,
          lat,
          lng,
          sourceSlug: META.slug,
        });
        dots.push({
          id: station.id,
          label: station.label,
          lat,
          lng,
          value: latestLevel.properties.LEVEL!,
          unit: 'm',
          at,
        });
      }
      if (latestDischarge) {
        const [lng, lat] = latestDischarge.geometry.coordinates;
        readings.push({
          stationId: `${META.slug}:${station.id}`,
          metric: 'discharge',
          value: latestDischarge.properties.DISCHARGE!,
          unit: 'm³/s',
          at: Date.parse(latestDischarge.properties.DATETIME),
          lat,
          lng,
          sourceSlug: META.slug,
        });
      }
    }

    if (reachable === 0) {
      await ctx.runMutation(internal.feeds.ecccHydrometric.fail, {
        error: lastError || 'no station reachable',
      });
      return;
    }
    await ctx.runMutation(internal.feeds.ecccHydrometric.ingest, { readings, stations: dots });
  },
});

export const ingest = internalMutation({
  args: { readings: v.array(v.any()), stations: v.array(v.any()) },
  handler: async (ctx, { readings, stations }) => {
    const inserted = await insertReadings(ctx, readings as ReadingInput[]);
    await writeSnapshot(ctx, `stations:${META.slug}`, JSON.stringify(stations));
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
