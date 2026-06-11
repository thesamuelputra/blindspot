import { query } from './_generated/server';

// Active CAP-grade alerts (ECCC, NAAD, tsunami, evac orders) for map + banner.
export const active = query({
  args: {},
  handler: async (ctx) => {
    if ((await ctx.auth.getUserIdentity()) === null) return [];
    const rows = await ctx.db
      .query('alerts')
      .withIndex('by_status', (q) => q.eq('status', 'active'))
      .order('desc')
      .take(200);
    // belt-and-suspenders: hide anything past its expiry even if the feed
    // hasn't flipped the status yet
    const now = Date.now();
    return rows.filter((a) => !a.expires || a.expires > now);
  },
});
