// Read-only internal queries powering the AI analyst tool loop (ARCHITECTURE §7.4).
// Every export the analyst action can reach is an internalQuery, so the analyst is
// read-only by construction: there is no mutation in this module to call.
// Rows are compacted for the model: raw + provenance stripped; signals/entities keep
// a stringified _id so the model can echo ids back as map highlights.
// Worst-case reads per call are bounded: take() caps of 100 to 300 rows, plus one
// 2000-row bounded scan for count_by_kind.
import { v } from 'convex/values';
import { internalQuery } from '../_generated/server';
import type { Doc } from '../_generated/dataModel';
import { distance, point } from '@turf/turf';

export interface NearFilter {
  lat: number;
  lng: number;
  km: number;
}

// Turf post-filter for the `near` argument (pure, fixture-tested).
export function withinKm(lat: number, lng: number, near: NearFilter): boolean {
  return (
    distance(point([lng, lat]), point([near.lng, near.lat]), { units: 'kilometers' }) <= near.km
  );
}

// Clamp a model-supplied limit into [1, max] (pure, fixture-tested).
export function clampLimit(requested: number | undefined, fallback: number, max: number): number {
  if (typeof requested !== 'number' || !Number.isFinite(requested)) return fallback;
  return Math.max(1, Math.min(Math.floor(requested), max));
}

// Compact rows for the model context: keep what an analyst needs, drop raw payloads.
export function compactSignal(s: Doc<'signals'>) {
  return {
    id: String(s._id),
    kind: s.kind,
    title: s.title,
    summary: s.summary,
    severity: s.severity,
    lat: s.lat,
    lng: s.lng,
    observedAt: s.observedAt,
    expiresAt: s.expiresAt,
    confidence: s.confidence,
    sourceSlug: s.sourceSlug,
    rationale: s.rationale,
  };
}

export function compactEntity(e: Doc<'entities'>) {
  return {
    id: String(e._id),
    kind: e.kind,
    extId: e.extId,
    label: e.label,
    lat: e.lat,
    lng: e.lng,
    heading: e.heading,
    speed: e.speed,
    altitude: e.altitude,
    lastSeenAt: e.lastSeenAt,
    stale: e.stale,
    watch: e.watch,
  };
}

const nearValidator = v.object({ lat: v.number(), lng: v.number(), km: v.number() });

// Index scan cap before the Turf near post-filter / limit slice.
const SIGNAL_SCAN_CAP = 200;
const COUNT_SCAN_CAP = 2000;
const DEFAULT_ENTITY_KINDS = ['aircraft', 'vessel', 'ferry', 'bus', 'balloon'];

export const query_signals = internalQuery({
  args: {
    kind: v.optional(v.string()),
    sinceMinutes: v.number(),
    near: v.optional(nearValidator),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { kind, sinceMinutes, near, limit }) => {
    const cap = clampLimit(limit, 50, 200);
    const cutoff = Date.now() - Math.max(1, sinceMinutes) * 60_000;
    const rows = kind
      ? await ctx.db
          .query('signals')
          .withIndex('by_kind_observed', (q) => q.eq('kind', kind).gte('observedAt', cutoff))
          .order('desc')
          .take(SIGNAL_SCAN_CAP)
      : await ctx.db
          .query('signals')
          .withIndex('by_observed', (q) => q.gte('observedAt', cutoff))
          .order('desc')
          .take(SIGNAL_SCAN_CAP);
    const filtered = near
      ? rows.filter((s) => s.lat !== undefined && s.lng !== undefined && withinKm(s.lat, s.lng, near))
      : rows;
    return filtered.slice(0, cap).map(compactSignal);
  },
});

export const query_entities = internalQuery({
  args: {
    kind: v.optional(v.string()),
    watchOnly: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { kind, watchOnly, limit }) => {
    const cap = clampLimit(limit, 100, 300);
    if (watchOnly) {
      const rows = await ctx.db
        .query('entities')
        .withIndex('by_watch', (q) => q.eq('watch', true))
        .order('desc')
        .take(cap);
      return rows.filter((e) => kind === undefined || e.kind === kind).map(compactEntity);
    }
    const kinds = kind ? [kind] : DEFAULT_ENTITY_KINDS;
    const rows: Doc<'entities'>[] = [];
    for (const k of kinds) {
      rows.push(
        ...(await ctx.db
          .query('entities')
          .withIndex('by_kind', (q) => q.eq('kind', k))
          .order('desc')
          .take(Math.min(cap, 150))),
      );
    }
    rows.sort((a, b) => b.lastSeenAt - a.lastSeenAt);
    return rows.slice(0, cap).map(compactEntity);
  },
});

export const query_readings = internalQuery({
  args: {
    metric: v.string(),
    stationId: v.optional(v.string()),
    sinceMinutes: v.number(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { metric, stationId, sinceMinutes, limit }) => {
    const cap = clampLimit(limit, 100, 200);
    const cutoff = Date.now() - Math.max(1, sinceMinutes) * 60_000;
    const rows = stationId
      ? await ctx.db
          .query('readings')
          .withIndex('by_station_metric_at', (q) =>
            q.eq('stationId', stationId).eq('metric', metric).gte('at', cutoff),
          )
          .order('desc')
          .take(cap)
      : await ctx.db
          .query('readings')
          .withIndex('by_metric_at', (q) => q.eq('metric', metric).gte('at', cutoff))
          .order('desc')
          .take(cap);
    return rows.map((r) => ({
      stationId: r.stationId,
      metric: r.metric,
      value: r.value,
      unit: r.unit,
      at: r.at,
      lat: r.lat,
      lng: r.lng,
    }));
  },
});

export const query_alerts = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query('alerts')
      .withIndex('by_status', (q) => q.eq('status', 'active'))
      .order('desc')
      .take(100);
    // No id on purpose: only signals/entities are highlightable on the map.
    return rows.map((a) => ({
      headline: a.headline,
      severity: a.severity,
      urgency: a.urgency,
      certainty: a.certainty,
      effective: a.effective,
      expires: a.expires,
      sourceSlug: a.sourceSlug,
      hasArea: a.area !== undefined,
    }));
  },
});

export const get_threat = internalQuery({
  args: {},
  handler: async (ctx) => {
    const t = await ctx.db
      .query('threat')
      .withIndex('by_at')
      .order('desc')
      .first();
    if (!t) return null;
    let factors: unknown = [];
    try {
      factors = JSON.parse(t.factors);
    } catch {
      factors = [];
    }
    return { level: t.level, score: t.score, computedAt: t.computedAt, factors };
  },
});

export const get_source_health = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query('sources').collect();
    return rows.map((s) => ({
      slug: s.slug,
      name: s.name,
      cluster: s.cluster,
      status: s.status,
      cadenceSec: s.cadenceSec,
      lastSuccessAt: s.lastSuccessAt,
      consecutiveFailures: s.consecutiveFailures,
      lastError: s.lastError,
      lastCount: s.lastCount,
    }));
  },
});

export const count_by_kind = internalQuery({
  args: { sinceMinutes: v.number() },
  handler: async (ctx, { sinceMinutes }) => {
    const cutoff = Date.now() - Math.max(1, sinceMinutes) * 60_000;
    const rows = await ctx.db
      .query('signals')
      .withIndex('by_observed', (q) => q.gte('observedAt', cutoff))
      .order('desc')
      .take(COUNT_SCAN_CAP);
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.kind] = (counts[r.kind] ?? 0) + 1;
    return { counts, scanned: rows.length, truncated: rows.length === COUNT_SCAN_CAP };
  },
});
