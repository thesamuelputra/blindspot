import { v } from 'convex/values';
import { internalAction, internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { fetchSource } from '../lib/fetchSource';
import { CASCADIA_BBOX, cellOf } from '../lib/geo';
import { upsertSignals, reportSuccess, reportFailure, type SourceMeta } from '../lib/ingest';

// usgs-quakes — SOURCES.md: Seismic & Tsunami. FDSN GeoJSON, no auth, Cascadia
// box (deliberately wider than VI — offshore events matter). Worst case ~200
// records/sync (limit param). Cadence: fast lane (120s).
const META: SourceMeta = {
  slug: 'usgs-quakes',
  name: 'USGS Earthquakes (FDSN)',
  cluster: 'Seismic & Tsunami',
  cadenceSec: 120,
  attribution: 'U.S. Geological Survey',
};

const SEVERITY = (mag: number): 'info' | 'watch' | 'warning' | 'critical' =>
  mag >= 6 ? 'critical' : mag >= 4.5 ? 'warning' : mag >= 3 ? 'watch' : 'info';

export const sync = internalAction({
  args: {},
  handler: async (ctx) => {
    const url =
      'https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson' +
      `&minlatitude=${CASCADIA_BBOX.south}&maxlatitude=${CASCADIA_BBOX.north}` +
      `&minlongitude=${CASCADIA_BBOX.west}&maxlongitude=${CASCADIA_BBOX.east}` +
      '&minmagnitude=1&orderby=time&limit=200';
    try {
      const res = await fetchSource(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        features: Array<{
          id: string;
          properties: { mag: number | null; place: string | null; time: number; url?: string };
          geometry: { coordinates: [number, number, number] };
        }>;
      };
      const fetchedAt = Date.now();
      const signals = data.features
        .filter((f) => f.properties.mag !== null)
        .map((f) => {
          const [lng, lat, depthKm] = f.geometry.coordinates;
          const mag = f.properties.mag ?? 0;
          return {
            sourceSlug: META.slug,
            kind: 'earthquake',
            title: `M${mag.toFixed(1)} — ${f.properties.place ?? 'unknown location'}`,
            summary: `Depth ${depthKm.toFixed(0)} km`,
            severity: SEVERITY(mag),
            lat,
            lng,
            cell: cellOf(lat, lng),
            observedAt: f.properties.time,
            dedupeKey: `${META.slug}:${f.id}`,
            confidence: 1.0,
            provenance: JSON.stringify({ method: 'poll', fetchedAt, upstreamId: f.id, url: f.properties.url }),
            raw: JSON.stringify({ mag, depthKm: Math.round(depthKm) }),
          };
        });
      await ctx.runMutation(internal.feeds.usgsQuakes.ingest, { signals });
    } catch (e) {
      await ctx.runMutation(internal.feeds.usgsQuakes.fail, { error: String(e) });
    }
  },
});

export const ingest = internalMutation({
  args: { signals: v.array(v.any()) },
  handler: async (ctx, { signals }) => {
    const { inserted, updated } = await upsertSignals(ctx, signals);
    await reportSuccess(ctx, META, signals.length);
    return { inserted, updated };
  },
});

export const fail = internalMutation({
  args: { error: v.string() },
  handler: async (ctx, { error }) => {
    await reportFailure(ctx, META, error);
  },
});
