import { v } from 'convex/values';
import { query } from './_generated/server';

// Recent path for one mover (hover trails + inspector flight/voyage path).
export const trail = query({
  args: {
    kind: v.string(),
    extId: v.string(),
    sinceMs: v.number(), // window length
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { kind, extId, sinceMs, limit }) => {
    if ((await ctx.auth.getUserIdentity()) === null) return null;
    const entity = await ctx.db
      .query('entities')
      .withIndex('by_ext', (q) => q.eq('kind', kind).eq('extId', extId))
      .unique();
    if (!entity) return null;
    const cutoff = Date.now() - sinceMs;
    const points = await ctx.db
      .query('tracks')
      .withIndex('by_entity_at', (q) => q.eq('entityId', entity._id).gte('at', cutoff))
      .order('desc')
      .take(Math.min(limit ?? 200, 500));
    return {
      entity: {
        kind: entity.kind,
        extId: entity.extId,
        label: entity.label,
        lat: entity.lat,
        lng: entity.lng,
        heading: entity.heading,
        speed: entity.speed,
        altitude: entity.altitude,
        state: entity.state,
        firstSeenAt: entity.firstSeenAt,
        lastSeenAt: entity.lastSeenAt,
        stale: entity.stale,
        watch: entity.watch,
      },
      // chronological for PathLayer
      points: points.reverse().map((p) => ({ lat: p.lat, lng: p.lng, at: p.at, alt: p.altitude })),
    };
  },
});
