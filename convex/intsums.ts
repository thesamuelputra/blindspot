import { v } from 'convex/values';
import { action, query } from './_generated/server';
import { internal } from './_generated/api';

// INTSUM surface (ARCHITECTURE §7.5): latest digest on COMMAND + ANALYST,
// short history for review. Auth-gated like every public query (the console
// is private). Rows are written by convex/brain/intsum.ts only; the public
// regenerate action below just triggers that same generator on demand.

export const latest = query({
  args: {},
  handler: async (ctx) => {
    if ((await ctx.auth.getUserIdentity()) === null) return null;
    return await ctx.db.query('intsums').withIndex('by_at').order('desc').first();
  },
});

export const recent = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    if ((await ctx.auth.getUserIdentity()) === null) return [];
    const n = Math.min(Math.max(limit ?? 12, 1), 50);
    return await ctx.db.query('intsums').withIndex('by_at').order('desc').take(n);
  },
});

// On-demand regenerate (ANALYST page button, ARCHITECTURE §7.5): same path as
// the 4h cron. The generator stores at most one row per run and degrades
// cleanly when the API key is missing, so this is safe to expose behind auth.
export const regenerate = action({
  args: {},
  handler: async (ctx): Promise<null> => {
    if ((await ctx.auth.getUserIdentity()) === null) {
      throw new Error('Not authenticated');
    }
    await ctx.runAction(internal.brain.intsum.generate, {});
    return null;
  },
});
