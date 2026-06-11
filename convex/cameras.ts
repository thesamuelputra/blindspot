import { query } from './_generated/server';

// Camera inventory for the CAMS layer + cams page. Auth-gated like
// sources.health — unauthenticated callers get an empty list, never an error.
// Inventory changes rarely (hourly cron), so layers query this directly.
export const list = query({
  args: {},
  handler: async (ctx) => {
    if ((await ctx.auth.getUserIdentity()) === null) return [];
    const cams = await ctx.db.query('cameras').collect();
    return cams.filter((c) => c.active);
  },
});
