import { v } from 'convex/values';
import { internalAction, internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { fetchSource } from '../lib/fetchSource';
import { upsertSignals, reportSuccess, reportFailure, type SignalInput, type SourceMeta } from '../lib/ingest';

// nasa-neo — SOURCES.md: Space (Objects). NASA/JPL NeoWs feed: Earth close
// approaches over the next 7 days (start_date=today, end_date=today+6 — the
// API's max window, verified live 2026-06-11: 33 objects across 7 dates).
// Signals kind 'space-weather', non-geographic (no lat/lng/cell — an
// asteroid approach has no surface point). Closest approaches first, capped
// at 20/sync. No map layer; SPACE page (Phase 5) renders the digest.
//
// Auth: NASA_API_KEY env if set, else the sanctioned DEMO_KEY (verified
// working; observed x-ratelimit-limit: 10/hr shared per IP — the daily
// cadence uses 1, so DEMO_KEY survives, but register a real key before
// anything else on this IP hits api.nasa.gov). Cadence 86400s: the feed is
// daily-granular, faster polling burns key budget for zero new data.
const META: SourceMeta = {
  slug: 'nasa-neo',
  name: 'NASA NeoWs Close Approaches',
  cluster: 'Space (Objects)',
  cadenceSec: 86400,
  attribution: 'NASA/JPL NeoWs',
  licenseNote: 'US Government / NASA data, public domain',
};

const DAY_MS = 24 * 3600 * 1000;
const MAX_SIGNALS = 20;

interface NeoApproach {
  close_approach_date_full: string; // '2026-Jun-14 13:11'
  epoch_date_close_approach: number; // epoch ms (verified)
  relative_velocity: { kilometers_per_second: string }; // strings upstream
  miss_distance: { lunar: string; kilometers: string }; // strings upstream
  orbiting_body: string;
}

interface NeoObject {
  id: string;
  name: string; // e.g. '510190 (2011 CX7)'
  nasa_jpl_url: string;
  estimated_diameter: { meters: { estimated_diameter_min: number; estimated_diameter_max: number } };
  is_potentially_hazardous_asteroid: boolean;
  close_approach_data: NeoApproach[];
}

interface NeoFeed {
  element_count: number;
  near_earth_objects: Record<string, NeoObject[]>; // keyed 'YYYY-MM-DD'
}

const utcDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export const sync = internalAction({
  args: {},
  handler: async (ctx) => {
    // Keyed source with a sanctioned public fallback — never gated off.
    const apiKey = process.env.NASA_API_KEY ?? 'DEMO_KEY';
    try {
      const now = Date.now();
      const url =
        'https://api.nasa.gov/neo/rest/v1/feed' +
        `?start_date=${utcDate(now)}&end_date=${utcDate(now + 6 * DAY_MS)}` +
        `&api_key=${apiKey}`;
      const res = await fetchSource(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const feed = (await res.json()) as NeoFeed;
      const fetchedAt = Date.now();

      const candidates: Array<{ neo: NeoObject; approach: NeoApproach; lunar: number }> = [];
      for (const date of Object.keys(feed.near_earth_objects ?? {})) {
        for (const neo of feed.near_earth_objects[date]) {
          // Feed-window entries carry the approach in question; guard for
          // Earth specifically (miss_distance values are STRINGS upstream).
          const approach = neo.close_approach_data.find((a) => a.orbiting_body === 'Earth');
          if (!approach) continue;
          const lunar = parseFloat(approach.miss_distance.lunar);
          if (!Number.isFinite(lunar)) continue;
          candidates.push({ neo, approach, lunar });
        }
      }
      // Closest first so the cap keeps the approaches that matter.
      candidates.sort((a, b) => a.lunar - b.lunar);

      const signals: SignalInput[] = candidates.slice(0, MAX_SIGNALS).map(({ neo, approach, lunar }) => {
        const dMax = neo.estimated_diameter.meters.estimated_diameter_max;
        const dMin = neo.estimated_diameter.meters.estimated_diameter_min;
        const kps = parseFloat(approach.relative_velocity.kilometers_per_second);
        // Severity (documented mapping, per spec): 'watch' only when the
        // approach is inside 1 lunar distance AND the object's max estimated
        // diameter exceeds 100 m; everything else — including JPL's
        // is_potentially_hazardous_asteroid orbital classification — is
        // 'info' (PHA flags long-term orbit class, not this week's pass).
        const severity: SignalInput['severity'] = lunar < 1 && dMax > 100 ? 'watch' : 'info';
        const approachAt = approach.epoch_date_close_approach;
        return {
          sourceSlug: META.slug,
          kind: 'space-weather',
          title: `NEO ${neo.name} — ${lunar.toFixed(1)} LD`.slice(0, 140),
          summary:
            `Closest approach ${approach.close_approach_date_full} UTC · ` +
            `est. ${Math.round(dMin)}–${Math.round(dMax)} m · ` +
            `${Number.isFinite(kps) ? kps.toFixed(1) : '?'} km/s` +
            (neo.is_potentially_hazardous_asteroid ? ' · PHA' : ''),
          severity,
          // non-geographic signal — no lat/lng/cell
          observedAt: fetchedAt,
          startsAt: approachAt,
          expiresAt: approachAt + DAY_MS,
          // id alone recurs across approach windows — date-qualify it.
          dedupeKey: `${META.slug}:${neo.id}:${utcDate(approachAt)}`,
          confidence: 1.0, // agency tier: NASA/JPL orbit solutions
          provenance: JSON.stringify({
            method: 'poll',
            fetchedAt,
            upstreamId: neo.id,
            url: neo.nasa_jpl_url,
          }),
          raw: JSON.stringify({
            lunar: lunar.toFixed(2),
            missKm: Math.round(parseFloat(approach.miss_distance.kilometers)),
            diameterM: [Math.round(dMin), Math.round(dMax)],
            hazardous: neo.is_potentially_hazardous_asteroid,
          }),
        };
      });

      await ctx.runMutation(internal.feeds.nasaNeo.ingest, { signals });
    } catch (e) {
      await ctx.runMutation(internal.feeds.nasaNeo.fail, { error: String(e) });
    }
  },
});

export const ingest = internalMutation({
  args: { signals: v.array(v.any()) },
  handler: async (ctx, { signals }) => {
    const { inserted, updated } = await upsertSignals(ctx, signals as SignalInput[]);
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
