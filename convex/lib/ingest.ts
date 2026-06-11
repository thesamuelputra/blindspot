import type { MutationCtx } from '../_generated/server';

// Shared upsert + health helpers used by every feed module's ingest mutation
// (ARCHITECTURE §5). Plain functions over MutationCtx — not Convex functions —
// so each feed keeps exactly one action + one mutation.

export interface SignalInput {
  sourceSlug: string;
  kind: string;
  title: string;
  summary?: string;
  severity: 'info' | 'watch' | 'warning' | 'critical';
  lat?: number;
  lng?: number;
  cell?: string;
  geojson?: string;
  startsAt?: number;
  observedAt: number;
  expiresAt?: number;
  dedupeKey: string;
  confidence: number;
  provenance: string;
  raw?: string;
}

export async function upsertSignals(
  ctx: MutationCtx,
  signals: SignalInput[],
): Promise<{ inserted: number; updated: number }> {
  let inserted = 0;
  let updated = 0;
  for (const s of signals) {
    const existing = await ctx.db
      .query('signals')
      .withIndex('by_dedupe', (q) => q.eq('dedupeKey', s.dedupeKey))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        title: s.title,
        summary: s.summary,
        severity: s.severity,
        lat: s.lat,
        lng: s.lng,
        cell: s.cell,
        geojson: s.geojson,
        observedAt: s.observedAt,
        expiresAt: s.expiresAt,
        provenance: s.provenance,
        raw: s.raw,
      });
      updated++;
    } else {
      await ctx.db.insert('signals', s);
      inserted++;
    }
  }
  return { inserted, updated };
}

export interface ReadingInput {
  stationId: string; // "<sourceSlug>:<upstream station id>"
  metric: string;
  value: number;
  unit: string;
  at: number;
  lat?: number;
  lng?: number;
  sourceSlug: string;
}

// Append readings, skipping exact (stationId, metric, at) duplicates —
// overlapping polls are the norm for station feeds.
export async function insertReadings(ctx: MutationCtx, readings: ReadingInput[]): Promise<number> {
  let inserted = 0;
  for (const r of readings) {
    const dupe = await ctx.db
      .query('readings')
      .withIndex('by_station_metric_at', (q) =>
        q.eq('stationId', r.stationId).eq('metric', r.metric).eq('at', r.at),
      )
      .first();
    if (!dupe) {
      await ctx.db.insert('readings', r);
      inserted++;
    }
  }
  return inserted;
}

export interface SourceMeta {
  slug: string;
  name: string;
  cluster: string;
  cadenceSec: number;
  attribution: string;
  licenseNote?: string;
}

export async function reportSuccess(
  ctx: MutationCtx,
  meta: SourceMeta,
  count: number,
): Promise<void> {
  const now = Date.now();
  const row = await ctx.db
    .query('sources')
    .withIndex('by_slug', (q) => q.eq('slug', meta.slug))
    .unique();
  if (row) {
    await ctx.db.patch(row._id, {
      status: 'live',
      lastSyncAt: now,
      lastSuccessAt: now,
      lastError: undefined,
      consecutiveFailures: 0,
      lastCount: count,
    });
  } else {
    await ctx.db.insert('sources', {
      ...meta,
      status: 'live',
      lastSyncAt: now,
      lastSuccessAt: now,
      consecutiveFailures: 0,
      lastCount: count,
    });
  }
}

export async function reportFailure(
  ctx: MutationCtx,
  meta: SourceMeta,
  error: string,
): Promise<void> {
  const now = Date.now();
  const row = await ctx.db
    .query('sources')
    .withIndex('by_slug', (q) => q.eq('slug', meta.slug))
    .unique();
  if (row) {
    const failures = row.consecutiveFailures + 1;
    await ctx.db.patch(row._id, {
      status: failures >= 3 ? 'down' : 'stale',
      lastSyncAt: now,
      lastError: error.slice(0, 500),
      consecutiveFailures: failures,
    });
  } else {
    await ctx.db.insert('sources', {
      ...meta,
      status: 'stale',
      lastSyncAt: now,
      lastError: error.slice(0, 500),
      consecutiveFailures: 1,
    });
  }
}
