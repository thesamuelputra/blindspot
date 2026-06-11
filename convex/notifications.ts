import { v } from 'convex/values';
import { mutation, query } from './_generated/server';

// Client alerting surface (ARCHITECTURE §7.6, BRIEF §8.8). Rows are written
// server-side by brain/alerting.ts notify(); this file is the read and
// acknowledge side for the console. Auth-gated like every public function:
// queries return empty for unauthenticated callers, mutations throw.

export const unacked = query({
  args: {},
  handler: async (ctx) => {
    if ((await ctx.auth.getUserIdentity()) === null) return [];
    return await ctx.db
      .query('notifications')
      .withIndex('by_ack', (q) => q.eq('ack', false))
      .order('desc')
      .take(50);
  },
});

export const recent = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    if ((await ctx.auth.getUserIdentity()) === null) return [];
    const n = Math.min(Math.max(limit ?? 20, 1), 50);
    return await ctx.db.query('notifications').withIndex('by_at').order('desc').take(n);
  },
});

export const ack = mutation({
  args: { id: v.id('notifications') },
  handler: async (ctx, { id }) => {
    if ((await ctx.auth.getUserIdentity()) === null) throw new Error('Not signed in');
    const doc = await ctx.db.get(id);
    if (!doc) return; // already purged by retention: ack is idempotent
    if (!doc.ack) await ctx.db.patch(id, { ack: true });
  },
});

export const ackAll = mutation({
  args: {},
  handler: async (ctx) => {
    if ((await ctx.auth.getUserIdentity()) === null) throw new Error('Not signed in');
    // Bounded sweep. 500 open rows is already far past anything the UI shows;
    // a second click clears any remainder.
    const open = await ctx.db
      .query('notifications')
      .withIndex('by_ack', (q) => q.eq('ack', false))
      .take(500);
    for (const n of open) await ctx.db.patch(n._id, { ack: true });
    return open.length;
  },
});
