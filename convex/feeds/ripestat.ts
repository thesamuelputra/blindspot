import { v } from 'convex/values';
import { internalAction, internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { fetchSource } from '../lib/fetchSource';
import {
  insertReadings,
  upsertSignals,
  reportSuccess,
  reportFailure,
  type ReadingInput,
  type SignalInput,
  type SourceMeta,
} from '../lib/ingest';

// ripestat — SOURCES.md: Infrastructure / Network / Cyber. RIPEstat
// routing-status data call for the two BC ISP ASNs (Telus AS852, Shaw/Rogers
// AS6327). No auth; sourceapp= identifier required by RIPE's fair-use note.
// BGP weather, not a live outage detector: query_time lags wall clock by up
// to ~8h (RIS dump cadence), so consecutive polls usually see the same dump
// and insertReadings dedupes on (stationId, metric, at).
//
// Readings: metric 'announced_prefixes' (announced_space.v4.prefixes — v4
// only; the v6 table is ~30 prefixes for AS852, where a 20% swing is noise)
// per ASN, stationId 'ripestat:as852' / 'ripestat:as6327'. Non-geographic —
// no lat/lng on readings, and the INFRASTRUCTURE page (Phase 5) consumes the
// series directly; no map layer, no snapshot.
//
// Anomaly rule (per spec): when a NEW dump (prev.at < new at) shows
// announced_prefixes more than 20% below the previous stored reading, emit
// one signal kind 'anomaly', severity 'watch', non-geographic. Confidence
// 0.6 — the underlying RIS data is agency-grade, but the drop signal itself
// is our modeled threshold inference, not an upstream-reported event.
//
// Verified live 2026-06-11: AS852 → 672 v4 prefixes, AS6327 → 3728, both
// status:'ok'. Gotcha confirmed the hard way: an uncached AS6327 response
// took 66.8s (HTTP 200) — hence timeoutMs 90s, well past the catalog's
// 30–45s advice. Max 8 concurrent requests per IP; we make 2, in parallel.
// Worst case: 2 readings + 2 signals per sync. Cadence: slow lane (1800s —
// data refreshes ~8-hourly, so this loses nothing).
const META: SourceMeta = {
  slug: 'ripestat',
  name: 'RIPEstat routing status (BC ISP ASNs)',
  cluster: 'Infrastructure / Network / Cyber',
  cadenceSec: 1800,
  attribution: 'RIPE NCC RIPEstat',
  licenseNote: 'RIPEstat Service Terms and Conditions — free with attribution',
};

const ASNS = [
  { resource: 'AS852', station: 'as852', label: 'Telus (AS852)' },
  { resource: 'AS6327', station: 'as6327', label: 'Shaw/Rogers (AS6327)' },
] as const;

const DROP_FRACTION = 0.2; // >20% fewer announced prefixes than previous reading

const urlFor = (resource: string): string =>
  `https://stat.ripe.net/data/routing-status/data.json?resource=${resource}&sourceapp=blindspot-osint`;

// query_time arrives as '2026-06-11T08:00:00' — UTC without an offset.
function parseUtc(s: string): number {
  return Date.parse(s.endsWith('Z') ? s : s + 'Z');
}

interface RoutingStatus {
  status?: string;
  data?: {
    visibility?: { v4?: { ris_peers_seeing?: number; total_ris_peers?: number } };
    announced_space?: { v4?: { prefixes?: number; ips?: number } };
    observed_neighbours?: number;
    query_time?: string;
    resource?: string;
  };
}

export const sync = internalAction({
  args: {},
  handler: async (ctx) => {
    const results = await Promise.allSettled(
      ASNS.map(async (a) => {
        const res = await fetchSource(urlFor(a.resource), { timeoutMs: 90_000 });
        if (!res.ok) throw new Error(`${a.resource}: HTTP ${res.status}`);
        const body = (await res.json()) as RoutingStatus;
        if (body.status !== 'ok') throw new Error(`${a.resource}: status ${body.status ?? 'missing'}`);
        const prefixes = body.data?.announced_space?.v4?.prefixes;
        const at = parseUtc(body.data?.query_time ?? '');
        if (typeof prefixes !== 'number' || !Number.isFinite(at)) {
          throw new Error(`${a.resource}: missing announced_space.v4.prefixes or query_time`);
        }
        return { station: a.station, resource: a.resource, prefixes, at };
      }),
    );

    const readings: ReadingInput[] = [];
    const errors: string[] = [];
    for (const r of results) {
      if (r.status === 'rejected') {
        errors.push(String(r.reason instanceof Error ? r.reason.message : r.reason));
        continue;
      }
      readings.push({
        stationId: `${META.slug}:${r.value.station}`,
        metric: 'announced_prefixes',
        value: r.value.prefixes,
        unit: 'prefixes',
        at: r.value.at,
        sourceSlug: META.slug,
      });
    }

    // Partial success is success; only a both-ASNs wipeout marks the source.
    if (readings.length === 0) {
      await ctx.runMutation(internal.feeds.ripestat.fail, {
        error: errors.join('; ') || 'no routing-status data returned',
      });
      return;
    }
    await ctx.runMutation(internal.feeds.ripestat.ingest, { readings });
  },
});

export const ingest = internalMutation({
  args: { readings: v.array(v.any()) },
  handler: async (ctx, args) => {
    const readings = args.readings as ReadingInput[];
    const fetchedAt = Date.now();
    const signals: SignalInput[] = [];

    // Compare each new dump against the latest stored reading BEFORE insert.
    for (const r of readings) {
      const prev = await ctx.db
        .query('readings')
        .withIndex('by_station_metric_at', (q) =>
          q.eq('stationId', r.stationId).eq('metric', r.metric),
        )
        .order('desc')
        .first();
      if (!prev || prev.at >= r.at || prev.value <= 0) continue; // same dump or no history
      if (r.value >= prev.value * (1 - DROP_FRACTION)) continue;
      const asn = ASNS.find((a) => `${META.slug}:${a.station}` === r.stationId);
      const dropPct = Math.round((1 - r.value / prev.value) * 100);
      signals.push({
        sourceSlug: META.slug,
        kind: 'anomaly',
        title: `BGP visibility drop: ${asn?.label ?? r.stationId} announced prefixes down ${dropPct}%`,
        summary: `Announced IPv4 prefixes fell ${prev.value} → ${r.value} between RIS dumps (threshold >20%). Possible large withdrawal or routing incident.`,
        severity: 'watch',
        // non-geographic signal — no lat/lng/cell
        observedAt: r.at,
        dedupeKey: `${META.slug}:${asn?.station ?? r.stationId}:drop:${r.at}`,
        confidence: 0.6, // modeled threshold over agency-grade RIS data
        provenance: JSON.stringify({
          method: 'poll',
          fetchedAt,
          upstreamId: asn?.resource,
          url: asn ? urlFor(asn.resource) : undefined,
        }),
        raw: JSON.stringify({ previous: prev.value, current: r.value, previousAt: prev.at }),
      });
    }

    await insertReadings(ctx, readings);
    await upsertSignals(ctx, signals);
    await reportSuccess(ctx, META, readings.length + signals.length);
  },
});

export const fail = internalMutation({
  args: { error: v.string() },
  handler: async (ctx, { error }) => {
    await reportFailure(ctx, META, error);
  },
});
