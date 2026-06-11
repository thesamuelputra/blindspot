import { v } from 'convex/values';
import { query } from './_generated/server';

// Reactive client queries over the normalized core. Auth-gated: every public
// query checks identity (the console is private).

// Cross-kind recent signals (event ticker, ⌘K). Bounded.
export const recent = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    if ((await ctx.auth.getUserIdentity()) === null) return [];
    return await ctx.db
      .query('signals')
      .withIndex('by_observed')
      .order('desc')
      .take(Math.min(limit ?? 30, 100));
  },
});

export const byKind = query({
  args: {
    kind: v.string(),
    sinceMs: v.number(), // window length, not a timestamp
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { kind, sinceMs, limit }) => {
    if ((await ctx.auth.getUserIdentity()) === null) return [];
    const cutoff = Date.now() - sinceMs;
    return await ctx.db
      .query('signals')
      .withIndex('by_kind_observed', (q) => q.eq('kind', kind).gte('observedAt', cutoff))
      .order('desc')
      .take(Math.min(limit ?? 500, 1000));
  },
});
