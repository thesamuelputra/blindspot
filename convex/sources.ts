import { query } from './_generated/server';

export const health = query({
  args: {},
  handler: async (ctx) => {
    if ((await ctx.auth.getUserIdentity()) === null) return [];
    return await ctx.db.query('sources').collect();
  },
});
