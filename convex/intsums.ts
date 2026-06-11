import { v } from 'convex/values';
import { query } from './_generated/server';

// INTSUM surface (ARCHITECTURE §7.5): latest digest on COMMAND + ANALYST,
// short history for review. Auth-gated like every public query (the console
// is private). Rows are written by convex/brain/intsum.ts only.

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
