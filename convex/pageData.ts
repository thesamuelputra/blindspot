import { v } from 'convex/values';
import { query } from './_generated/server';

// Shared reads for the cluster pages (HAZARD, SKIES & SEAS, GROUND, SIGNALS,
// INFRA, PULSE, ENVIRO, SPACE). Auth-gated and bounded: per-kind and
// per-metric takes are capped, kinds/metrics lists are capped, so the worst
// case stays well under Convex read limits.

const MAX_KINDS = 8;
const MAX_PER_KIND = 50;
const MAX_METRICS = 8;
const MAX_PER_METRIC = 100;

// Recent signals across several kinds, newest first. `sinceMs` is a window
// length (same convention as signals.byKind), `limit` caps each kind.
export const signalsByKinds = query({
  args: {
    kinds: v.array(v.string()),
    sinceMs: v.number(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { kinds, sinceMs, limit }) => {
    if ((await ctx.auth.getUserIdentity()) === null) return [];
    const cutoff = Date.now() - sinceMs;
    const per = Math.min(Math.max(limit ?? MAX_PER_KIND, 1), MAX_PER_KIND);
    const out = [];
    for (const kind of kinds.slice(0, MAX_KINDS)) {
      const rows = await ctx.db
        .query('signals')
        .withIndex('by_kind_observed', (q) => q.eq('kind', kind).gte('observedAt', cutoff))
        .order('desc')
        .take(per);
      out.push(...rows);
    }
    return out.sort((a, b) => b.observedAt - a.observedAt);
  },
});

// Latest reading per station for each requested metric. Scans the newest
// `limit` rows per metric (by_metric_at desc) and keeps the first row seen
// per station, so each station appears once with its freshest value.
export const latestReadings = query({
  args: {
    metrics: v.array(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { metrics, limit }) => {
    if ((await ctx.auth.getUserIdentity()) === null) return [];
    const per = Math.min(Math.max(limit ?? MAX_PER_METRIC, 1), MAX_PER_METRIC);
    const out = [];
    for (const metric of metrics.slice(0, MAX_METRICS)) {
      const rows = await ctx.db
        .query('readings')
        .withIndex('by_metric_at', (q) => q.eq('metric', metric))
        .order('desc')
        .take(per);
      const seen = new Set<string>();
      for (const r of rows) {
        if (seen.has(r.stationId)) continue;
        seen.add(r.stationId);
        out.push(r);
      }
    }
    return out;
  },
});
