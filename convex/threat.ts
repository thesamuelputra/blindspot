import { query } from './_generated/server';

// Latest regional threat level (ARCHITECTURE §7.7) for the SYSTEM page and the
// header chip. Auth-gated like every public query (the console is private).
// Factors are stored as JSON on the row; parse them here so the client gets a
// ready-to-render list.

export const latest = query({
  args: {},
  handler: async (ctx) => {
    if ((await ctx.auth.getUserIdentity()) === null) return null;
    const row = await ctx.db.query('threat').withIndex('by_at').order('desc').first();
    if (!row) return null;
    let factors: Array<{ label: string; weight: number; signalId?: string }> = [];
    try {
      factors = JSON.parse(row.factors) as typeof factors;
    } catch {
      // malformed factors JSON degrades to an empty list, never a crashed page
    }
    return {
      _id: row._id,
      computedAt: row.computedAt,
      level: row.level,
      score: row.score,
      factors,
    };
  },
});
