import { query } from './_generated/server';

// SYSTEM ops board backing query (BRIEF §4 page 14, §8.10). One round trip,
// every read bounded and targeted: the sources registry (one row per feed,
// bounded by the catalog), indexed .take() counts, .first() on by_at indexes,
// and the compact positions:* snapshots for entity counts. No table scans.

const MOVER_KINDS = ['aircraft', 'vessel', 'ferry', 'bus', 'balloon'] as const;
const NOTIF_COUNT_CAP = 500;

export const overview = query({
  args: {},
  handler: async (ctx) => {
    if ((await ctx.auth.getUserIdentity()) === null) return null;
    const now = Date.now();

    // full health rows for the FEED HEALTH table
    const sources = await ctx.db.query('sources').collect();

    // active alerts, expiry-filtered the same way alerts.active does it
    const activeAlerts = await ctx.db
      .query('alerts')
      .withIndex('by_status', (q) => q.eq('status', 'active'))
      .order('desc')
      .take(200);
    const alertsActive = activeAlerts.filter((a) => !a.expires || a.expires > now).length;

    // unacked notifications, capped; the client shows "500+" at the cap
    const unacked = await ctx.db
      .query('notifications')
      .withIndex('by_ack', (q) => q.eq('ack', false))
      .order('desc')
      .take(NOTIF_COUNT_CAP);

    // latest regional threat row, factors parsed server-side
    const threatRow = await ctx.db.query('threat').withIndex('by_at').order('desc').first();
    let threat: {
      level: 'NOMINAL' | 'ELEVATED' | 'HIGH';
      score: number;
      computedAt: number;
      factors: Array<{ label: string; weight: number }>;
    } | null = null;
    if (threatRow) {
      let factors: Array<{ label: string; weight: number }> = [];
      try {
        factors = JSON.parse(threatRow.factors) as typeof factors;
      } catch {
        // malformed factors JSON degrades to an empty list, never a crashed board
      }
      threat = {
        level: threatRow.level,
        score: threatRow.score,
        computedAt: threatRow.computedAt,
        factors,
      };
    }

    const latestIntsum = await ctx.db.query('intsums').withIndex('by_at').order('desc').first();

    // entity counts per mover kind from the compact positions:* snapshots —
    // never raw entities scans (ARCHITECTURE §11)
    const entities: Record<string, number> = {};
    for (const kind of MOVER_KINDS) {
      const snap = await ctx.db
        .query('snapshots')
        .withIndex('by_key', (q) => q.eq('key', `positions:${kind}`))
        .unique();
      if (!snap) continue;
      try {
        const list = JSON.parse(snap.json) as unknown;
        if (Array.isArray(list)) entities[kind] = list.length;
      } catch {
        // unreadable snapshot: the kind is omitted and the tile sums what it has
      }
    }

    return {
      now,
      sources,
      counts: {
        alertsActive,
        notificationsUnacked: unacked.length,
        notificationsCapped: unacked.length === NOTIF_COUNT_CAP,
        entities,
      },
      threat,
      intsumAt: latestIntsum?.at ?? null,
    };
  },
});
