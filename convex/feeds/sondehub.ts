import { v } from 'convex/values';
import { internalAction, internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { fetchSource } from '../lib/fetchSource';
import { CASCADIA_BBOX, inBbox } from '../lib/geo';
import { upsertMovers, type MoverInput } from '../lib/movers';
import { reportSuccess, reportFailure, type SourceMeta } from '../lib/ingest';

// sondehub — SOURCES.md: RF / Signals. Radiosondes heard in the last 24h
// within 500 km of the Island centroid, ingested as movers kind "balloon".
// Catalog gotcha: `distance` is METERS (distance=500 silently returns {});
// `last` is seconds. Empty result is `{}` not `[]` — and usually IS empty:
// the only regional uploader is N3UUO (Seattle) hearing Quillayute WA
// launches, so 0–2 sondes is normal and an empty sync is a success.
// Worst case ~10 records/sync. Cadence: medium lane (600s; wiki steers
// live consumers to MQTT, 5–10 min polling is the polite ceiling).
const META: SourceMeta = {
  slug: 'sondehub',
  name: 'SondeHub v2 (radiosondes)',
  cluster: 'RF / Signals',
  cadenceSec: 600,
  attribution: 'SondeHub',
  licenseNote: 'CC BY-SA 2.0 — share-alike applies to derived published layers',
};

const URL = 'https://api.v2.sondehub.org/sondes?lat=49.5&lon=-124.5&distance=500000&last=86400';

interface SondeTelemetry {
  serial: string;
  datetime?: string; // sonde GPS time of the latest frame
  time_received?: string;
  lat?: number;
  lon?: number;
  alt?: number;
  heading?: number; // degrees clockwise from north
  vel_h?: number; // horizontal velocity, m/s
  type?: string; // e.g. "RS41"
  subtype?: string;
  frame?: number;
}

export const sync = internalAction({
  args: {},
  handler: async (ctx) => {
    try {
      const res = await fetchSource(URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Response is an object keyed by serial (one latest-frame entry each).
      const data = (await res.json()) as Record<string, SondeTelemetry>;
      const now = Date.now();
      const movers: MoverInput[] = Object.values(data)
        // Cascadia box, not strict VI: the region's only consistently tracked
        // launches (Quillayute WA, 47.95°N) sit just south of VI_BBOX, while
        // interior-BC sondes ~420 km east fall outside the Cascadia east edge.
        // Mirrors the usgsQuakes "deliberately wider than VI" precedent.
        .filter(
          (s) =>
            typeof s.lat === 'number' &&
            typeof s.lon === 'number' &&
            inBbox(s.lat, s.lon, CASCADIA_BBOX),
        )
        .map((s) => {
          const at = Date.parse(s.datetime ?? s.time_received ?? '');
          return {
            extId: s.serial,
            label: s.serial,
            lat: s.lat!,
            lng: s.lon!,
            heading: s.heading,
            speed: s.vel_h,
            altitude: s.alt,
            state: JSON.stringify({ type: s.type, frame: s.frame }),
            at: Number.isFinite(at) ? at : now,
          };
        });
      await ctx.runMutation(internal.feeds.sondehub.ingest, { movers });
    } catch (e) {
      await ctx.runMutation(internal.feeds.sondehub.fail, { error: String(e) });
    }
  },
});

export const ingest = internalMutation({
  args: { movers: v.array(v.any()) },
  handler: async (ctx, { movers }) => {
    const count = await upsertMovers(ctx, 'balloon', META.slug, movers as MoverInput[]);
    await reportSuccess(ctx, META, count);
  },
});

export const fail = internalMutation({
  args: { error: v.string() },
  handler: async (ctx, { error }) => {
    await reportFailure(ctx, META, error);
  },
});
