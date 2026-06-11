import { v } from 'convex/values';
import { internalAction, internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { fetchSource } from '../lib/fetchSource';
import { CASCADIA_BBOX, cellOf, inBbox } from '../lib/geo';
import { upsertSignals, reportSuccess, reportFailure, type SourceMeta } from '../lib/ingest';

// nrcan-quakes — SOURCES.md: Seismic & Tsunami. Earthquakes Canada FDSN event
// service, no auth, Cascadia box, last ~30 days. format=text (pipe-delimited);
// GeoJSON is NOT supported upstream (verified 422). Empty result is HTTP 204
// (FDSN standard) = success with 0 records. Worst case ~200 records/sync
// (limit param; a 30-day Cascadia window held ~80 at build time). NRCan and
// USGS both report big events under different dedupeKeys — accepted for now
// (cross-source merge is Phase 4). Cadence: fast lane (240s).
const META: SourceMeta = {
  slug: 'nrcan-quakes',
  name: 'Earthquakes Canada (FDSN)',
  cluster: 'Seismic & Tsunami',
  cadenceSec: 240,
  attribution: 'Source: Earthquakes Canada, Natural Resources Canada',
};

// Severity from the upstream Magnitude column (field 7 of the pipe-delimited
// text response) — same thresholds as usgs-quakes.
const SEVERITY = (mag: number): 'info' | 'watch' | 'warning' | 'critical' =>
  mag >= 6 ? 'critical' : mag >= 4.5 ? 'warning' : mag >= 3 ? 'watch' : 'info';

export const sync = internalAction({
  args: {},
  handler: async (ctx) => {
    const starttime = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const url =
      'https://www.earthquakescanada.nrcan.gc.ca/fdsnws/event/1/query?format=text' +
      `&minlatitude=${CASCADIA_BBOX.south}&maxlatitude=${CASCADIA_BBOX.north}` +
      `&minlongitude=${CASCADIA_BBOX.west}&maxlongitude=${CASCADIA_BBOX.east}` +
      `&starttime=${starttime}&minmagnitude=1&orderby=time&limit=200`;
    try {
      const res = await fetchSource(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // 204 No Content (no events in window) yields an empty body → 0 signals.
      const body = res.status === 204 ? '' : await res.text();
      const fetchedAt = Date.now();
      // #EventID|Time|Latitude|Longitude|Depth/km|MagType|Magnitude|EventLocationName
      const signals = body
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('#'))
        .map((line) => line.split('|'))
        .filter((cols) => cols.length >= 8)
        .map((cols) => {
          const [id, time, latStr, lngStr, depthStr, , magStr, locationName] = cols;
          return {
            id,
            observedAt: Date.parse(time),
            lat: Number(latStr),
            lng: Number(lngStr),
            depthKm: Number(depthStr),
            mag: Number(magStr),
            // EventLocationName is bilingual "EN/FR" — keep the English half.
            place: locationName.split('/')[0].trim(),
          };
        })
        .filter(
          (e) =>
            e.id !== '' &&
            Number.isFinite(e.observedAt) &&
            Number.isFinite(e.lat) &&
            Number.isFinite(e.lng) &&
            Number.isFinite(e.mag) &&
            // Query is already bbox-bounded upstream; guard anyway (rule §5.4).
            inBbox(e.lat, e.lng, CASCADIA_BBOX),
        )
        .map((e) => ({
          sourceSlug: META.slug,
          kind: 'earthquake',
          title: `M${e.mag.toFixed(1)} — ${e.place || 'unknown location'}`,
          summary: Number.isFinite(e.depthKm) ? `Depth ${e.depthKm.toFixed(0)} km` : undefined,
          severity: SEVERITY(e.mag),
          lat: e.lat,
          lng: e.lng,
          cell: cellOf(e.lat, e.lng),
          observedAt: e.observedAt,
          dedupeKey: `${META.slug}:${e.id}`,
          confidence: 1.0,
          provenance: JSON.stringify({ method: 'poll', fetchedAt, upstreamId: e.id, url }),
          raw: JSON.stringify({
            mag: e.mag,
            depthKm: Number.isFinite(e.depthKm) ? Math.round(e.depthKm) : null,
          }),
        }));
      await ctx.runMutation(internal.feeds.nrcanQuakes.ingest, { signals });
    } catch (e) {
      await ctx.runMutation(internal.feeds.nrcanQuakes.fail, { error: String(e) });
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
