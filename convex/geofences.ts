import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { extractFencePolygon } from './brain/geofence';

// Public geofence CRUD (ARCHITECTURE §7.2). Auth-gated like the rest of the
// console: queries return empty for unauthenticated callers, mutations throw.
// Evaluation lives in convex/brain/geofence.ts (pure, runs in the brain tick).

const severity = v.union(
  v.literal('info'),
  v.literal('watch'),
  v.literal('warning'),
  v.literal('critical'),
);

const fenceRule = v.union(v.literal('enter'), v.literal('exit'), v.literal('dwell'));

export const list = query({
  args: {},
  handler: async (ctx) => {
    if ((await ctx.auth.getUserIdentity()) === null) return [];
    // full inventory (active and inactive) for the management UI; the brain
    // tick reads only active fences via its own index query
    return await ctx.db.query('geofences').collect();
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    geojson: v.string(),
    rule: fenceRule,
    dwellSec: v.optional(v.number()),
    entityKinds: v.array(v.string()),
    severity,
  },
  handler: async (ctx, args) => {
    if ((await ctx.auth.getUserIdentity()) === null) throw new Error('Not signed in');
    if (!args.name.trim()) throw new Error('Fence name is required');
    if (extractFencePolygon(args.geojson) === null)
      throw new Error('geojson must contain a Polygon or MultiPolygon');
    if (args.rule === 'dwell' && (!args.dwellSec || args.dwellSec <= 0))
      throw new Error('Dwell fences need dwellSec greater than zero');
    return await ctx.db.insert('geofences', {
      name: args.name.trim(),
      geojson: args.geojson,
      rule: args.rule,
      dwellSec: args.dwellSec,
      entityKinds: args.entityKinds,
      severity: args.severity,
      active: true,
    });
  },
});

export const setActive = mutation({
  args: { id: v.id('geofences'), active: v.boolean() },
  handler: async (ctx, { id, active }) => {
    if ((await ctx.auth.getUserIdentity()) === null) throw new Error('Not signed in');
    const fence = await ctx.db.get(id);
    if (!fence) throw new Error('Fence not found');
    await ctx.db.patch(id, { active });
  },
});

export const remove = mutation({
  args: { id: v.id('geofences') },
  handler: async (ctx, { id }) => {
    if ((await ctx.auth.getUserIdentity()) === null) throw new Error('Not signed in');
    const fence = await ctx.db.get(id);
    if (!fence) return; // already gone: removal is idempotent
    // cascade-delete per-entity states (§7.2 / §11) so a recreated fence
    // never inherits stale inside flags
    const states = await ctx.db
      .query('geofenceStates')
      .withIndex('by_fence_entity', (q) => q.eq('fenceId', id))
      .collect();
    for (const s of states) await ctx.db.delete(s._id);
    await ctx.db.delete(id);
  },
});
