import { v } from 'convex/values';
import { query } from './_generated/server';

// Replay window queries (ARCHITECTURE §8): bounded history access for the
// time scrubber. A Convex query may scan at most 32K docs, so both queries
// enforce hard budgets and the client scrubs the fetched window locally.

const HOUR_MS = 3_600_000;
const MAX_WINDOW_MS = 48 * HOUR_MS; // bound to retention (§11)
const MAX_KINDS = 5;
const MAX_ENTITIES_PER_KIND = 150;
const MAX_POINTS_PER_ENTITY = 200;
const MAX_TOTAL_POINTS = 15_000; // downsample by stride past this
const SCAN_BUDGET = 28_000; // stay safely under the 32K doc-scan cap

interface ReplayTrack {
  kind: string;
  extId: string;
  label: string;
  points: Array<{ lat: number; lng: number; at: number }>;
}

// Per-kind mover tracks inside [fromMs, toMs]. Entities seen in the window,
// then each entity's track points via by_entity_at. Chronological points,
// timestamps in epoch ms (the client rebases for TripsLayer).
export const moverTracksWindow = query({
  args: {
    kinds: v.array(v.string()),
    fromMs: v.number(),
    toMs: v.number(),
  },
  handler: async (ctx, args): Promise<ReplayTrack[]> => {
    if ((await ctx.auth.getUserIdentity()) === null) return [];
    const toMs = args.toMs;
    const fromMs = Math.max(args.fromMs, toMs - MAX_WINDOW_MS);
    if (fromMs >= toMs) return [];

    const out: ReplayTrack[] = [];
    let scanned = 0;
    let totalPoints = 0;

    for (const kind of args.kinds.slice(0, MAX_KINDS)) {
      if (scanned >= SCAN_BUDGET) break;
      const entities = await ctx.db
        .query('entities')
        .withIndex('by_kind', (q) => q.eq('kind', kind).gte('lastSeenAt', fromMs))
        .order('desc')
        .take(Math.min(MAX_ENTITIES_PER_KIND, SCAN_BUDGET - scanned));
      scanned += entities.length;

      for (const entity of entities) {
        const remaining = SCAN_BUDGET - scanned;
        if (remaining < 2) break;
        const rows = await ctx.db
          .query('tracks')
          .withIndex('by_entity_at', (q) =>
            q.eq('entityId', entity._id).gte('at', fromMs).lte('at', toMs),
          )
          .take(Math.min(MAX_POINTS_PER_ENTITY, remaining));
        scanned += rows.length;
        if (rows.length < 2) continue;
        out.push({
          kind,
          extId: entity.extId,
          label: entity.label,
          points: rows.map((p) => ({ lat: p.lat, lng: p.lng, at: p.at })),
        });
        totalPoints += rows.length;
      }
    }

    // Cap the payload: stride-downsample every track, always keep endpoints.
    if (totalPoints > MAX_TOTAL_POINTS) {
      const stride = Math.ceil(totalPoints / MAX_TOTAL_POINTS);
      for (const track of out) {
        if (track.points.length <= 2) continue;
        const last = track.points[track.points.length - 1];
        const kept = track.points.filter((_, i) => i % stride === 0);
        if (kept[kept.length - 1] !== last) kept.push(last);
        track.points = kept;
      }
    }
    return out;
  },
});

// Signals observed inside [fromMs, toMs] that can be plotted (have lat/lng).
// Trimmed docs: no raw payloads or geometry blobs over the wire.
export const signalsWindow = query({
  args: {
    fromMs: v.number(),
    toMs: v.number(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if ((await ctx.auth.getUserIdentity()) === null) return [];
    const toMs = args.toMs;
    const fromMs = Math.max(args.fromMs, toMs - MAX_WINDOW_MS);
    if (fromMs >= toMs) return [];
    const rows = await ctx.db
      .query('signals')
      .withIndex('by_observed', (q) => q.gte('observedAt', fromMs).lte('observedAt', toMs))
      .order('desc')
      .take(Math.min(args.limit ?? 1000, 1000));
    return rows
      .filter((s) => s.lat !== undefined && s.lng !== undefined)
      .map((s) => ({
        id: s._id,
        kind: s.kind,
        title: s.title,
        summary: s.summary,
        severity: s.severity,
        lat: s.lat as number,
        lng: s.lng as number,
        observedAt: s.observedAt,
        sourceSlug: s.sourceSlug,
        confidence: s.confidence,
        provenance: s.provenance,
        rationale: s.rationale,
      }));
  },
});
