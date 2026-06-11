import { v } from 'convex/values';
import { internalAction, internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { fetchSource } from '../lib/fetchSource';
import { CASCADIA_BBOX, inBbox, cellOf } from '../lib/geo';
import { upsertSignals, reportSuccess, reportFailure, type SourceMeta } from '../lib/ingest';

// pnsn-tremor — SOURCES.md: Seismic & Tsunami. PNSN Cascadia episodic tremor
// catalog (tremorapi.pnsn.org v3.0), no auth, trailing 14-day window. The API
// returns the ENTIRE catalog footprint (verified: events down to lat 40.2 / N.
// California), so we filter to CASCADIA_BBOX server-side. Worst case during an
// active ETS episode is ~2000 events in-window; we cap what we store per sync
// to the 1500 most recent (see CAP below). Cadence: slow lane (1800s).
const META: SourceMeta = {
  slug: 'pnsn-tremor',
  name: 'PNSN Cascadia Tremor',
  cluster: 'Seismic & Tsunami',
  cadenceSec: 1800,
  attribution: 'Pacific Northwest Seismic Network — tremor catalog by A.G. Wech (Wech 2010, SRL 81:4)',
};

// ETS-episode guard: never persist more than the 1500 most recent in-bbox
// events per sync, no matter how big the upstream window payload gets.
const CAP = 1500;
const WINDOW_DAYS = 14;

const ymd = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export const sync = internalAction({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    // endtime is set one day ahead so today's events are always inside the
    // window regardless of whether the API treats endtime as inclusive
    // (verified: future endtime values are accepted).
    const url =
      'https://tremorapi.pnsn.org/api/v3.0/events' +
      `?starttime=${ymd(now - WINDOW_DAYS * 24 * 3600 * 1000)}` +
      `&endtime=${ymd(now + 24 * 3600 * 1000)}`;
    try {
      const res = await fetchSource(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        count: number;
        features: Array<{
          geometry: { coordinates: [number, number] };
          properties: {
            id: number;
            // RFC-1123 GMT string, e.g. "Thu, 28 May 2026 02:20:00 GMT" — not ISO 8601.
            time: string;
            depth?: number; // km
            duration?: number; // s
            magnitude?: number;
            num_stas?: number;
          };
        }>;
      };
      const fetchedAt = Date.now();
      const signals = data.features
        .map((f) => {
          const [lng, lat] = f.geometry.coordinates;
          const p = f.properties;
          const observedAt = Date.parse(p.time);
          return { lng, lat, p, observedAt };
        })
        .filter(({ lat, lng, observedAt }) => Number.isFinite(observedAt) && inBbox(lat, lng, CASCADIA_BBOX))
        // newest first, then cap — during an ETS episode the window can exceed
        // the budget; we keep the freshest CAP events. log: capped 14-day window.
        .sort((a, b) => b.observedAt - a.observedAt)
        .slice(0, CAP)
        .map(({ lat, lng, p, observedAt }) => ({
          sourceSlug: META.slug,
          kind: 'tremor',
          title: `Tremor M${(p.magnitude ?? 0).toFixed(1)} — ${lat.toFixed(2)}, ${lng.toFixed(2)}`,
          summary: p.depth !== undefined ? `Depth ${p.depth.toFixed(0)} km` : undefined,
          // Severity: always 'info'. The catalog has no severity field, and
          // tremor "magnitudes" (~0.8–1.2, properties.magnitude) are slow-slip
          // energy estimates, not damaging shaking — never alert-worthy alone.
          severity: 'info' as const,
          lat,
          lng,
          cell: cellOf(lat, lng),
          observedAt,
          dedupeKey: `${META.slug}:${p.id}`,
          confidence: 0.8, // community-instrument tier: automated research catalog, not a reviewed agency feed
          provenance: JSON.stringify({ method: 'poll', fetchedAt, upstreamId: p.id, url }),
          raw: p.depth !== undefined ? JSON.stringify({ depth: Math.round(p.depth * 10) / 10 }) : undefined,
        }));
      await ctx.runMutation(internal.feeds.pnsnTremor.ingest, { signals });
    } catch (e) {
      await ctx.runMutation(internal.feeds.pnsnTremor.fail, { error: String(e) });
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
