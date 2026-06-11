import { v } from 'convex/values';
import { paginationOptsValidator } from 'convex/server';
import { internalAction, internalMutation, internalQuery } from '../_generated/server';
import { internal } from '../_generated/api';

// Rolling baselines for anomaly detection (ARCHITECTURE §7.3).
//
// Hourly cron `updateBaselines` recomputes mean/stddev/p95 over the last 7d of
// `readings` for:
//   - brain tick mover counts: count:aircraft / count:vessel / count:bus
//     (written by brain/evaluate commit at 15-min resolution, stationId
//     "brain:counts") -> baseline key is the metric itself
//   - station readings: aqhi / water_level, grouped per station ->
//     baseline key "<metric>:<stationId>", e.g. "aqhi:eccc-aqhi:100"
// Only groups with >= 20 samples in the window get a baseline row; thin
// populations produce useless stddevs and would fire junk anomalies.
//
// v1 limitation, noted per spec: NO time-of-day bucketing yet. A single 7d
// mean flattens the diurnal cycle (aircraft counts at 03:00 vs 15:00), so the
// z>3 gate in brain/anomaly.ts is deliberately conservative. v2 should bucket
// count:* baselines by local hour-of-day band before tightening thresholds.
// `rate:quakes` is also not computed here yet; brain/anomaly.ts treats it as
// optional and stays silent until something writes it.
//
// Worst-case record count: one row per baseline key — 3 count metrics plus
// one per reporting aqhi/water_level station, ~100-200 rows total. Reads are
// paginated (500/page, hard cap 64 pages per metric) so no single query
// approaches the 32K-doc scan limit.

const WINDOW_HOURS = 168; // 7d
const MIN_SAMPLES = 20;
const PAGE_SIZE = 500;
const MAX_PAGES_PER_METRIC = 64;

const COUNT_METRICS = ['count:aircraft', 'count:vessel', 'count:bus'];
const STATION_METRICS = ['aqhi', 'water_level'];

export interface BaselineStats {
  mean: number;
  stddev: number;
  p95: number;
}

// Pure stats over a sample population (population stddev; p95 by rank).
export function computeStats(values: number[]): BaselineStats {
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const stddev = Math.sqrt(variance);
  const sorted = [...values].sort((a, b) => a - b);
  const p95 = sorted[Math.min(n - 1, Math.max(0, Math.ceil(0.95 * n) - 1))];
  return { mean, stddev, p95 };
}

// One bounded page of readings for a metric within the window. The action
// loops this with a cursor; each call is its own transaction, so the 7d scan
// never hits per-query limits.
export const readingsPage = internalQuery({
  args: {
    metric: v.string(),
    since: v.number(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query('readings')
      .withIndex('by_metric_at', (q) => q.eq('metric', args.metric).gte('at', args.since))
      .paginate(args.paginationOpts);
    return {
      rows: page.page.map((r) => ({ stationId: r.stationId, value: r.value })),
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

export const upsert = internalMutation({
  args: {
    rows: v.array(
      v.object({
        metric: v.string(),
        windowHours: v.number(),
        mean: v.number(),
        stddev: v.number(),
        p95: v.number(),
        n: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    for (const row of args.rows) {
      const existing = await ctx.db
        .query('baselines')
        .withIndex('by_metric', (q) => q.eq('metric', row.metric))
        .unique();
      if (existing) await ctx.db.patch(existing._id, { ...row, updatedAt: now });
      else await ctx.db.insert('baselines', { ...row, updatedAt: now });
    }
  },
});

// Hourly cron entry point (wired in convex/crons.ts by the orchestrator).
export const updateBaselines = internalAction({
  args: {},
  handler: async (ctx): Promise<void> => {
    const since = Date.now() - WINDOW_HOURS * 3600_000;
    const rows: Array<{
      metric: string;
      windowHours: number;
      mean: number;
      stddev: number;
      p95: number;
      n: number;
    }> = [];

    for (const metric of [...COUNT_METRICS, ...STATION_METRICS]) {
      // baseline key -> sample values
      const groups = new Map<string, number[]>();
      let cursor: string | null = null;
      for (let i = 0; i < MAX_PAGES_PER_METRIC; i++) {
        const page = (await ctx.runQuery(internal.brain.baselines.readingsPage, {
          metric,
          since,
          paginationOpts: { numItems: PAGE_SIZE, cursor },
        })) as {
          rows: Array<{ stationId: string; value: number }>;
          isDone: boolean;
          continueCursor: string;
        };
        for (const r of page.rows) {
          const key = metric.startsWith('count:') ? metric : `${metric}:${r.stationId}`;
          const bucket = groups.get(key);
          if (bucket) bucket.push(r.value);
          else groups.set(key, [r.value]);
        }
        if (page.isDone) break;
        cursor = page.continueCursor;
      }

      for (const [key, values] of groups) {
        if (values.length < MIN_SAMPLES) continue;
        const stats = computeStats(values);
        rows.push({
          metric: key,
          windowHours: WINDOW_HOURS,
          mean: stats.mean,
          stddev: stats.stddev,
          p95: stats.p95,
          n: values.length,
        });
      }
    }

    if (rows.length > 0) await ctx.runMutation(internal.brain.baselines.upsert, { rows });
  },
});
