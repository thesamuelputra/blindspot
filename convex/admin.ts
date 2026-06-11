import { v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';

// Dev/RUNBOOK utility: npx convex run admin:healthSummary
export const healthSummary = internalQuery({
  args: {},
  handler: async (ctx) => {
    const sources = await ctx.db.query('sources').collect();
    const snapshots = await ctx.db.query('snapshots').collect();
    return {
      sources: sources
        .map((s) => `${s.slug}: ${s.status} n=${s.lastCount ?? '?'} ${s.lastError ?? ''}`)
        .sort(),
      snapshots: snapshots.map((s) => `${s.key}: ${s.json.length}B`).sort(),
    };
  },
});

// Dev/RUNBOOK utility: npx convex run admin:deleteEntity '{"kind":"vessel","extId":"316000000"}'
// Removes a single entity + its tracks + rewrites the positions snapshot (e.g. test data).
export const deleteEntity = internalMutation({
  args: { kind: v.string(), extId: v.string() },
  handler: async (ctx, { kind, extId }) => {
    const entity = await ctx.db
      .query('entities')
      .withIndex('by_ext', (q) => q.eq('kind', kind).eq('extId', extId))
      .unique();
    if (!entity) return 'not found';
    const tracks = await ctx.db
      .query('tracks')
      .withIndex('by_entity_at', (q) => q.eq('entityId', entity._id))
      .collect();
    for (const t of tracks) await ctx.db.delete(t._id);
    await ctx.db.delete(entity._id);
    const snap = await ctx.db
      .query('snapshots')
      .withIndex('by_key', (q) => q.eq('key', `positions:${kind}`))
      .unique();
    if (snap) {
      const list = (JSON.parse(snap.json) as Array<{ id: string }>).filter((m) => m.id !== extId);
      await ctx.db.patch(snap._id, { json: JSON.stringify(list), updatedAt: Date.now() });
    }
    return `deleted ${kind}:${extId} (+${tracks.length} tracks)`;
  },
});

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
