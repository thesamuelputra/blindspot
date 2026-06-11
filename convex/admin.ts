import { internalMutation } from './_generated/server';

// Dev/RUNBOOK utility — internal-only (not client-callable). Wipes all auth
// records so the operator account can be re-seeded:
//   npx convex run admin:wipeUsers
export const wipeUsers = internalMutation({
  args: {},
  handler: async (ctx) => {
    const tables = ['authSessions', 'authAccounts', 'authRefreshTokens', 'users'] as const;
    let deleted = 0;
    for (const table of tables) {
      for (const doc of await ctx.db.query(table).collect()) {
        await ctx.db.delete(doc._id);
        deleted++;
      }
    }
    return { deleted };
  },
});
