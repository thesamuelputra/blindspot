import { v } from 'convex/values';
import { internalAction, internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { fetchSource } from '../lib/fetchSource';
import {
  insertReadings,
  reportSuccess,
  reportFailure,
  type ReadingInput,
  type SourceMeta,
} from '../lib/ingest';

// cloudflare-radar — SOURCES.md: Infrastructure / Network / Cyber. NEEDS-KEY:
// free Cloudflare account + custom API token (Account > Radar > Read), env
// var CLOUDFLARE_RADAR_TOKEN — until it lands every sync fails cleanly with
// 'CLOUDFLARE_RADAR_TOKEN not configured' and the source row shows down.
// That is the expected state for now (PLAN.md keys queue: 'Cloudflare Radar
// token | cyber weather | panel shows n/a').
//
// Canada-level cyber weather, two readings per sync on station
// 'cloudflare-radar:ca' (no province granularity exists upstream):
//   cf_traffic_change — /radar/netflows/timeseries?location=CA with
//     normalization=PERCENTAGE_CHANGE (documented Radar param): latest sample
//     of CA traffic % change vs the preceding period.
//   cf_attack_share  — /radar/attacks/layer7/top/locations/target: Canada's
//     share (%) of global L7 attack traffic by target country over the last
//     day. CA absent from the top-100 list ⇒ share below the cutoff,
//     recorded as 0 to keep the series continuous.
// Non-geographic source — no lat/lng, no signals, no map layer, no snapshot
// (INFRASTRUCTURE page consumes the series in Phase 5).
//
// Error shape verified live 2026-06-11 (unauthenticated): HTTP 4xx with
// {success:false, errors:[{code:9106, message:'Missing X-Auth-Key,
// X-Auth-Email or Authorization headers'}], messages:[], result:null}.
// CAVEAT: that auth gate fires before path routing (a bogus /radar path
// returns the same 9106), so the two paths above follow the docs but could
// NOT be path-verified keyless — re-check both URLs when the token lands,
// and the documented result shapes ({result:{serie_0:{timestamps,values}}}
// and {result:{top_0:[{…Alpha2, value}]}}) are parsed defensively (values
// may be strings; the CA match scans for any '…Alpha2' key).
// Worst case: 2 readings per sync. Cadence: slow lane (1800s; aggregates lag
// minutes-to-hours, well inside Cloudflare's 1200 req / 5 min global limit).
const META: SourceMeta = {
  slug: 'cloudflare-radar',
  name: 'Cloudflare Radar (Canada traffic & attacks)',
  cluster: 'Infrastructure / Network / Cyber',
  cadenceSec: 1800,
  attribution: 'Cloudflare Radar (https://radar.cloudflare.com)',
  licenseNote: 'CC BY-NC 4.0 — personal non-commercial dashboard use only',
};

const API = 'https://api.cloudflare.com/client/v4/radar';
const STATION = `${META.slug}:ca`;
const TRAFFIC_URL = `${API}/netflows/timeseries?location=CA&dateRange=1d&normalization=PERCENTAGE_CHANGE&format=json`;
const ATTACKS_URL = `${API}/attacks/layer7/top/locations/target?dateRange=1d&limit=100&format=json`;

interface CfEnvelope<T> {
  success?: boolean;
  errors?: Array<{ code?: number; message?: string }>;
  result?: T | null;
}

interface CfTimeseries {
  serie_0?: { timestamps?: string[]; values?: Array<string | number | null> };
}

interface CfTopLocations {
  top_0?: Array<Record<string, unknown>>;
}

async function cfJson<T>(url: string, token: string, label: string): Promise<T> {
  const res = await fetchSource(url, {
    headers: { Authorization: `Bearer ${token}` },
    timeoutMs: 30_000,
  });
  let body: CfEnvelope<T> | null = null;
  try {
    body = (await res.json()) as CfEnvelope<T>;
  } catch {
    // non-JSON body handled below
  }
  if (!res.ok || body?.success === false || body?.result == null) {
    const detail = body?.errors?.length
      ? body.errors.map((e) => `${e.message ?? 'error'} (code ${e.code})`).join('; ')
      : `HTTP ${res.status}`;
    throw new Error(`${label}: ${detail}`);
  }
  return body.result as T;
}

const toFinite = (x: unknown): number | null => {
  const n = typeof x === 'string' ? parseFloat(x) : typeof x === 'number' ? x : NaN;
  return Number.isFinite(n) ? n : null;
};

// Latest sample of serie_0 whose value parses to a finite number.
function latestPoint(ts: CfTimeseries): { value: number; at: number } | null {
  const timestamps = ts.serie_0?.timestamps ?? [];
  const values = ts.serie_0?.values ?? [];
  for (let i = Math.min(timestamps.length, values.length) - 1; i >= 0; i--) {
    const value = toFinite(values[i]);
    const at = Date.parse(timestamps[i] ?? '');
    if (value !== null && Number.isFinite(at)) return { value, at };
  }
  return null;
}

// Find Canada's row by scanning for any '…Alpha2' key with value 'CA'
// (origin/target variants differ only in the key prefix).
function canadaShare(top: CfTopLocations): number {
  for (const row of top.top_0 ?? []) {
    const isCa = Object.entries(row).some(
      ([k, val]) => /alpha2$/i.test(k) && String(val).toUpperCase() === 'CA',
    );
    if (!isCa) continue;
    return toFinite(row.value) ?? 0;
  }
  return 0; // below the top-100 cutoff this period
}

export const sync = internalAction({
  args: {},
  handler: async (ctx) => {
    const token = process.env.CLOUDFLARE_RADAR_TOKEN;
    if (!token) {
      await ctx.runMutation(internal.feeds.cloudflareRadar.fail, {
        error: 'CLOUDFLARE_RADAR_TOKEN not configured (see PLAN.md keys queue)',
      });
      return;
    }
    try {
      const [traffic, attacks] = await Promise.all([
        cfJson<CfTimeseries>(TRAFFIC_URL, token, 'netflows/timeseries'),
        cfJson<CfTopLocations>(ATTACKS_URL, token, 'attacks/layer7/top'),
      ]);
      const fetchedAt = Date.now();

      const readings: ReadingInput[] = [];
      const point = latestPoint(traffic);
      if (point) {
        readings.push({
          stationId: STATION,
          metric: 'cf_traffic_change',
          value: point.value,
          unit: '%',
          at: point.at,
          sourceSlug: META.slug,
        });
      }
      readings.push({
        stationId: STATION,
        metric: 'cf_attack_share',
        value: canadaShare(attacks),
        unit: '%',
        at: fetchedAt, // 1d rolling aggregate — stamped at poll time
        sourceSlug: META.slug,
      });

      await ctx.runMutation(internal.feeds.cloudflareRadar.ingest, { readings });
    } catch (e) {
      await ctx.runMutation(internal.feeds.cloudflareRadar.fail, { error: String(e) });
    }
  },
});

export const ingest = internalMutation({
  args: { readings: v.array(v.any()) },
  handler: async (ctx, { readings }) => {
    const inserted = await insertReadings(ctx, readings as ReadingInput[]);
    await reportSuccess(ctx, META, readings.length);
    return { inserted };
  },
});

export const fail = internalMutation({
  args: { error: v.string() },
  handler: async (ctx, { error }) => {
    await reportFailure(ctx, META, error);
  },
});
