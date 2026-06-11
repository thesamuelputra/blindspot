import { v } from 'convex/values';
import { internalAction, internalMutation, internalQuery } from '../_generated/server';
import { internal } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import { RULE_IMPLS } from './rules';
import { evaluateGeofences, type GeofenceStateChange } from './geofence';
import { evaluateAnomalies } from './anomaly';
import { computeThreat } from './threat';
import type { BrainContext, DerivedCandidate, Severity } from './types';

// The brain tick (ARCHITECTURE §5/§7): single 120s cron, batched —
// ONE context query + rule evaluation in the action + ONE commit mutation.
// Geofence/anomaly/threat evaluators plug in here (Phase 4 wave).

const SIGNAL_KINDS_FOR_RULES = [
  'earthquake',
  'tremor',
  'wildfire',
  'hotspot',
  'space-weather',
  'anomaly',
  'derived',
];
const PER_KIND_CAP = 100;
const READINGS_CAP = 300;

export const loadContext = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const signals = [];
    for (const kind of SIGNAL_KINDS_FOR_RULES) {
      const rows = await ctx.db
        .query('signals')
        .withIndex('by_kind_observed', (q) => q.eq('kind', kind).gte('observedAt', now - 6 * 3600_000))
        .order('desc')
        .take(PER_KIND_CAP);
      signals.push(...rows);
    }
    const alerts = await ctx.db
      .query('alerts')
      .withIndex('by_status', (q) => q.eq('status', 'active'))
      .take(100);
    const freshCutoff = now - 10 * 60_000;
    const movers = [];
    for (const kind of ['aircraft', 'vessel', 'ferry', 'bus', 'balloon']) {
      const rows = await ctx.db
        .query('entities')
        .withIndex('by_kind', (q) => q.eq('kind', kind).gte('lastSeenAt', freshCutoff))
        .take(400);
      movers.push(...rows);
    }
    const readings = await ctx.db
      .query('readings')
      .withIndex('by_at', (q) => q.gte('at', now - 2 * 3600_000))
      .order('desc')
      .take(READINGS_CAP);
    const fences = await ctx.db
      .query('geofences')
      .withIndex('by_active', (q) => q.eq('active', true))
      .collect();
    const fenceStates = [];
    for (const f of fences) {
      const states = await ctx.db
        .query('geofenceStates')
        .withIndex('by_fence_entity', (q) => q.eq('fenceId', f._id))
        .collect();
      fenceStates.push(...states);
    }
    const watchlist = await ctx.db
      .query('watchlist')
      .withIndex('by_active', (q) => q.eq('active', true))
      .collect();
    const ruleRows = await ctx.db.query('rules').collect();
    const ruleParams: BrainContext['ruleParams'] = {};
    for (const r of ruleRows)
      ruleParams[r.slug] = { params: r.params, severity: r.severity, active: r.active };
    const sources = await ctx.db.query('sources').collect();
    // small table, one row per metric key (~100-200 rows worst case)
    const baselines = await ctx.db.query('baselines').collect();
    // durable tick counter (snapshots 'brain:tick', advanced in commit);
    // threat (§7.7) runs every 8th tick ≈ 16 min at the 120s cadence
    const tickRow = await ctx.db
      .query('snapshots')
      .withIndex('by_key', (q) => q.eq('key', 'brain:tick'))
      .unique();
    const tick = tickRow ? Number(tickRow.json) || 0 : 0;
    return {
      now,
      signals,
      alerts,
      movers,
      readings,
      fences,
      fenceStates,
      watchlist,
      ruleParams,
      sources,
      baselines,
      tick,
    };
  },
});

export const evaluate = internalAction({
  args: {},
  handler: async (ctx) => {
    const context = (await ctx.runQuery(internal.brain.evaluate.loadContext, {})) as BrainContext & {
      baselines: Doc<'baselines'>[];
      tick: number;
    };

    const derived: DerivedCandidate[] = [];
    for (const [slug, impl] of Object.entries(RULE_IMPLS)) {
      const config = context.ruleParams[slug];
      // absent config row = enabled with defaults (rows exist to disable/tune)
      if (config && !config.active) continue;
      let params: Record<string, unknown> = {};
      try {
        params = config ? (JSON.parse(config.params) as Record<string, unknown>) : {};
      } catch {
        /* bad params JSON → defaults */
      }
      try {
        derived.push(...impl(context, params));
      } catch (e) {
        console.error(`rule ${slug} threw:`, e);
      }
    }

    // geofence tripwires (§7.2)
    const geofence = evaluateGeofences(context);
    derived.push(...geofence.derived);

    // anomaly detection (§7.3) — second-arg baselines pattern
    derived.push(...evaluateAnomalies(context, context.baselines ?? []));

    // threat level every 8th tick (§7.7); tick counts completed ticks, so the
    // first tick after deploy also computes one (immediate baseline row)
    const threat = context.tick % 8 === 0 ? computeThreat(context) : undefined;

    await ctx.runMutation(internal.brain.evaluate.commit, {
      derived,
      fenceStateChanges: geofence.stateChanges,
      threat,
      counts: {
        aircraft: context.movers.filter((m) => m.kind === 'aircraft').length,
        vessel: context.movers.filter((m) => m.kind === 'vessel').length,
        bus: context.movers.filter((m) => m.kind === 'bus').length,
      },
    });
  },
});

export const commit = internalMutation({
  args: {
    derived: v.array(v.any()),
    counts: v.any(),
    fenceStateChanges: v.optional(v.array(v.any())),
    threat: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const derived = args.derived as DerivedCandidate[];
    const counts = args.counts as Record<string, number>;
    const now = Date.now();

    for (const d of derived) {
      const existing = await ctx.db
        .query('signals')
        .withIndex('by_dedupe', (q) => q.eq('dedupeKey', d.dedupeKey))
        .unique();
      if (existing) {
        await ctx.db.patch(existing._id, { observedAt: now, severity: d.severity as Severity });
        continue; // edge-triggered: no re-notify on persistence (§7.6)
      }
      const id = await ctx.db.insert('signals', {
        sourceSlug: 'brain',
        kind: 'derived',
        title: d.title,
        summary: d.summary,
        severity: d.severity as Severity,
        lat: d.lat,
        lng: d.lng,
        geojson: d.geojson,
        observedAt: now,
        dedupeKey: d.dedupeKey,
        confidence: d.confidence,
        provenance: JSON.stringify({ method: 'derived', fetchedAt: now, rule: d.rule }),
        rationale: d.rationale,
      });
      if (d.notify) {
        await ctx.scheduler.runAfter(0, internal.brain.alerting.notify, {
          severity: d.severity,
          title: d.title,
          body: d.summary,
          dedupeKey: d.dedupeKey,
          signalId: id,
        });
      }
    }

    // geofence state transitions (§7.2): patch-or-insert by (fenceId, entityId).
    // fireNow stamps lastFiredAt (dwell fires once per stay); explicit
    // undefined insideSince on patch clears the field (exit semantics).
    const fenceChanges = (args.fenceStateChanges ?? []) as GeofenceStateChange[];
    for (const c of fenceChanges) {
      const fenceId = c.fenceId as Id<'geofences'>;
      const entityId = c.entityId as Id<'entities'>;
      const existing = await ctx.db
        .query('geofenceStates')
        .withIndex('by_fence_entity', (q) => q.eq('fenceId', fenceId).eq('entityId', entityId))
        .unique();
      const fields = {
        insideSince: c.insideSince,
        lastInside: c.lastInside,
        ...(c.fireNow ? { lastFiredAt: now } : {}),
      };
      if (existing) await ctx.db.patch(existing._id, fields);
      else await ctx.db.insert('geofenceStates', { fenceId, entityId, ...fields });
    }

    // threat row (§7.7) — cleanup belongs to the retention task
    if (args.threat) {
      const t = args.threat as {
        level: 'NOMINAL' | 'ELEVATED' | 'HIGH';
        score: number;
        factors: Array<{ label: string; weight: number; signalId?: string }>;
      };
      await ctx.db.insert('threat', {
        computedAt: now,
        level: t.level,
        score: t.score,
        factors: JSON.stringify(t.factors),
      });
    }

    // advance the durable tick counter (read back in loadContext)
    const tickRow = await ctx.db
      .query('snapshots')
      .withIndex('by_key', (q) => q.eq('key', 'brain:tick'))
      .unique();
    const nextTick = (tickRow ? Number(tickRow.json) || 0 : 0) + 1;
    if (tickRow) await ctx.db.patch(tickRow._id, { json: String(nextTick), updatedAt: now });
    else await ctx.db.insert('snapshots', { key: 'brain:tick', json: String(nextTick), updatedAt: now });

    // mover counts as readings for anomaly baselines (§7.3) — 15-min resolution
    const quarter = Math.floor(now / 900_000) * 900_000;
    for (const [kind, count] of Object.entries(counts)) {
      const stationId = 'brain:counts';
      const metric = `count:${kind}`;
      const dupe = await ctx.db
        .query('readings')
        .withIndex('by_station_metric_at', (q) =>
          q.eq('stationId', stationId).eq('metric', metric).eq('at', quarter),
        )
        .first();
      if (!dupe)
        await ctx.db.insert('readings', {
          stationId,
          metric,
          value: count,
          unit: 'count',
          at: quarter,
          sourceSlug: 'brain',
        });
    }
  },
});
