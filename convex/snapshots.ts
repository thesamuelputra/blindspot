import { v } from 'convex/values';
import { query } from './_generated/server';

// Compact throttled aggregates (positions:<kind>, counters) — the only thing
// mover layers subscribe to (ARCHITECTURE §10/§11).
export const get = query({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    if ((await ctx.auth.getUserIdentity()) === null) return null;
    return await ctx.db
      .query('snapshots')
      .withIndex('by_key', (q) => q.eq('key', key))
      .unique();
  },
});
