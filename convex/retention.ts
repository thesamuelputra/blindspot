import { internalAction, internalMutation } from './_generated/server';
import { internal } from './_generated/api';

// Retention (ARCHITECTURE §11): self-rescheduling batch sweep — an hourly
// single batch cannot keep up with mover inflow, so the action loops batches
// until a sweep comes back under quota (bounded by MAX_ROUNDS per run).
// Policy: tracks > 48h; readings > 7d (brain:counts included at 7d);
// signals expired or > 14d (derived + incident-attached get 30d);
// notifications > 30d; threat > 24h; intsums > 90d; entities stale > 7d
// and not watchlisted (cascading their tracks + geofenceStates).

const BATCH = 400;
const MAX_ROUNDS = 25;

const H = 3600_000;
const D = 24 * H;

export const run = internalAction({
  args: {},
  handler: async (ctx) => {
    let total = 0;
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const deleted = (await ctx.runMutation(internal.retention.sweepBatch, {})) as number;
      total += deleted;
      if (deleted < BATCH) break;
    }
    console.log(`retention: removed ${total} rows`);
  },
});

export const sweepBatch = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let budget = BATCH;

    // 1. tracks > 48h (biggest writer)
    if (budget > 0) {
      const old = await ctx.db
        .query('tracks')
        .withIndex('by_at', (q) => q.lt('at', now - 2 * D))
        .take(budget);
      for (const t of old) await ctx.db.delete(t._id);
      budget -= old.length;
    }

    // 2. readings > 7d
    if (budget > 0) {
      const old = await ctx.db
        .query('readings')
        .withIndex('by_at', (q) => q.lt('at', now - 7 * D))
        .take(budget);
      for (const r of old) await ctx.db.delete(r._id);
      budget -= old.length;
    }

    // 3. signals: expired, or past kind-dependent age
    if (budget > 0) {
      const candidates = await ctx.db
        .query('signals')
        .withIndex('by_observed', (q) => q.lt('observedAt', now - 14 * D))
        .take(budget);
      for (const s of candidates) {
        const longLived = s.kind === 'derived';
        const cutoff = longLived ? 30 * D : 14 * D;
        if (now - s.observedAt < cutoff) continue;
        // incident-attached signals keep 30d
        const attached = await ctx.db
          .query('incidentSignals')
          .withIndex('by_signal', (q) => q.eq('signalId', s._id))
          .first();
        if (attached && now - s.observedAt < 30 * D) continue;
        await ctx.db.delete(s._id);
        budget--;
        if (budget <= 0) break;
      }
    }

    // 4. notifications > 30d
    if (budget > 0) {
      const old = await ctx.db
        .query('notifications')
        .withIndex('by_at', (q) => q.lt('at', now - 30 * D))
        .take(budget);
      for (const n of old) await ctx.db.delete(n._id);
      budget -= old.length;
    }

    // 5. threat > 24h
    if (budget > 0) {
      const old = await ctx.db
        .query('threat')
        .withIndex('by_at', (q) => q.lt('computedAt', now - D))
        .take(budget);
      for (const t of old) await ctx.db.delete(t._id);
      budget -= old.length;
    }

    // 6. intsums > 90d
    if (budget > 0) {
      const old = await ctx.db
        .query('intsums')
        .withIndex('by_at', (q) => q.lt('at', now - 90 * D))
        .take(budget);
      for (const i of old) await ctx.db.delete(i._id);
      budget -= old.length;
    }

    // 7. stale entities > 7d, not watchlisted — cascade tracks + fence states
    if (budget > 20) {
      const stale = await ctx.db
        .query('entities')
        .withIndex('by_watch', (q) => q.eq('watch', false).lt('lastSeenAt', now - 7 * D))
        .take(10); // cascades are expensive; small per-batch quota
      for (const e of stale) {
        const tracks = await ctx.db
          .query('tracks')
          .withIndex('by_entity_at', (q) => q.eq('entityId', e._id))
          .take(200);
        for (const t of tracks) await ctx.db.delete(t._id);
        if (tracks.length >= 200) continue; // more tracks remain — entity goes next round
        const states = await ctx.db.query('geofenceStates').collect();
        for (const s of states) if (s.entityId === e._id) await ctx.db.delete(s._id);
        await ctx.db.delete(e._id);
        budget -= tracks.length + 1;
        if (budget <= 0) break;
      }
    }

    return BATCH - budget;
  },
});
