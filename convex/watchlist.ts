import { v } from 'convex/values';
import { internalQuery, mutation, query } from './_generated/server';
import type { Id } from './_generated/dataModel';

// Watchlist CRUD (BRIEF §8.3, ARCHITECTURE §7.10). Public assets only per
// guardrails: vessels (MMSI), aircraft (icao24 hex), infrastructure (slug) —
// never private individuals. Auth-gated like the rest of the console:
// queries return empty/null for unauthenticated callers, mutations throw.
//
// Rows carry a rolling pattern-of-life JSON (`pattern`), folded daily by
// convex/brain/patternOfLife.ts so the profile outlives 48h track retention.
// When a watchlist row has a live entity match (entities.by_ext), the
// entity's `watch` flag is kept in sync so map layers can elevate the marker
// and retention never purges a watched entity (§11).

export const list = query({
  args: {},
  handler: async (ctx) => {
    if ((await ctx.auth.getUserIdentity()) === null) return [];
    return await ctx.db
      .query('watchlist')
      .withIndex('by_active', (q) => q.eq('active', true))
      .collect();
  },
});

// Membership lookup for one identity — WatchToggle and PatternOfLife both
// subscribe to this instead of the full list to keep reactive reads small.
export const forIdent = query({
  args: { kind: v.string(), identifier: v.string() },
  handler: async (ctx, { kind, identifier }) => {
    if ((await ctx.auth.getUserIdentity()) === null) return null;
    const row = await ctx.db
      .query('watchlist')
      .withIndex('by_ident', (q) => q.eq('kind', kind).eq('identifier', identifier))
      .unique();
    return row && row.active ? row : null;
  },
});

export const add = mutation({
  args: {
    kind: v.string(), // vessel | aircraft | infrastructure (entity kinds pass through)
    identifier: v.string(), // mmsi | hex | slug
    label: v.string(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if ((await ctx.auth.getUserIdentity()) === null) throw new Error('Not signed in');
    if (!args.identifier.trim()) throw new Error('Identifier is required');

    // flag the live entity when one exists (infrastructure rows may not)
    const entity = await ctx.db
      .query('entities')
      .withIndex('by_ext', (q) => q.eq('kind', args.kind).eq('extId', args.identifier))
      .unique();
    if (entity && !entity.watch) await ctx.db.patch(entity._id, { watch: true });

    // idempotent: re-adding an existing identity refreshes it in place,
    // preserving any accumulated pattern-of-life profile
    const existing = await ctx.db
      .query('watchlist')
      .withIndex('by_ident', (q) => q.eq('kind', args.kind).eq('identifier', args.identifier))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        active: true,
        label: args.label || existing.label,
        notes: args.notes ?? existing.notes,
      });
      return existing._id;
    }

    return await ctx.db.insert('watchlist', {
      kind: args.kind,
      identifier: args.identifier,
      label: args.label || args.identifier,
      notes: args.notes,
      active: true,
    });
  },
});

export const remove = mutation({
  args: { id: v.id('watchlist') },
  handler: async (ctx, { id }) => {
    if ((await ctx.auth.getUserIdentity()) === null) throw new Error('Not signed in');
    const row = await ctx.db.get(id);
    if (!row) return; // already gone: removal is idempotent
    const entity = await ctx.db
      .query('entities')
      .withIndex('by_ext', (q) => q.eq('kind', row.kind).eq('extId', row.identifier))
      .unique();
    if (entity && entity.watch) await ctx.db.patch(entity._id, { watch: false });
    await ctx.db.delete(id);
  },
});

// Active rows joined to their live entity, for the daily pattern-of-life
// cron. Rows without a matching entity (infrastructure, churned aircraft)
// are skipped — there are no tracks to fold for them.
export const activeWithEntities = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query('watchlist')
      .withIndex('by_active', (q) => q.eq('active', true))
      .collect();
    const out: Array<{
      watchlistId: Id<'watchlist'>;
      entityId: Id<'entities'>;
      kind: string;
      identifier: string;
      pattern?: string;
    }> = [];
    for (const row of rows) {
      const entity = await ctx.db
        .query('entities')
        .withIndex('by_ext', (q) => q.eq('kind', row.kind).eq('extId', row.identifier))
        .unique();
      if (entity)
        out.push({
          watchlistId: row._id,
          entityId: entity._id,
          kind: row.kind,
          identifier: row.identifier,
          pattern: row.pattern,
        });
    }
    return out;
  },
});
