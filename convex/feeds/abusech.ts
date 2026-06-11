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

// abusech — SOURCES.md: World Mode (Global). abuse.ch URLhaus + ThreatFox,
// aggregate cyber-weather gauges only. NEEDS-KEY: the Auth-Key requirement is
// enforced (verified live 2026-06-11: keyless calls → 401
// {"error":"Unauthorized"}; bad key → 403 {"query_status":"unknown_auth_key"}).
// One free key from auth.abuse.ch covers both APIs, env var ABUSECH_AUTH_KEY
// — until it lands every sync fails cleanly with 'ABUSECH_AUTH_KEY not
// configured' and the source row shows down. That is the expected state for
// now (PLAN.md keys queue).
//
// Method drift vs the catalog: URLhaus v1 /urls/recent/ is a GET — a POST
// with an Auth-Key header returns 405 {"query_status":"http_get_expected"}
// (verified). ThreatFox /api/v1/ is a JSON POST as documented.
//
// Per spec, individual malicious URLs/IOCs are NEVER stored as signals —
// AGGREGATE counts only, as readings on station 'abusech:global':
//   urlhaus_new_urls   — URLs added to URLhaus in the last 24h, counted from
//     /v1/urls/recent/limit/1000/ date_added ('YYYY-MM-DD hh:mm:ss UTC');
//     saturates at 1000 on an extreme day (fine for a gauge).
//   threatfox_new_iocs — IOCs from ThreatFox get_iocs days:1 (last 24h);
//     query_status 'no_result' is a quiet day, count 0.
// Non-geographic source — no lat/lng, no signals, no map layer, no snapshot
// (WORLD page consumes the series in Phase 5). Worst case 2 readings/sync.
// Cadence: 3600s (well inside the 'no faster than 5 min' export rule).
const META: SourceMeta = {
  slug: 'abusech',
  name: 'abuse.ch URLhaus + ThreatFox (aggregate)',
  cluster: 'World Mode (Global)',
  cadenceSec: 3600,
  attribution: 'abuse.ch (URLhaus / ThreatFox)',
  licenseNote: 'CC0 / community fair use; non-commercial OSINT use only',
};

const URLHAUS_URL = 'https://urlhaus-api.abuse.ch/v1/urls/recent/limit/1000/';
const THREATFOX_URL = 'https://threatfox-api.abuse.ch/api/v1/';
const STATION = `${META.slug}:global`;
const DAY_MS = 24 * 3600 * 1000;
const UA = 'BlindSpot/1.0 (personal OSINT console; samuel.putra101@gmail.com)';

interface UrlhausRecent {
  query_status?: string;
  urls?: Array<{ date_added?: string }>;
}

interface ThreatfoxIocs {
  query_status?: string;
  data?: unknown; // array of IOCs on 'ok'; an apology string on 'no_result'
}

// Both APIs wrap errors in {query_status} or {error} — surface whichever is
// present so a key problem reads as 'unknown_auth_key', not just 'HTTP 403'.
async function parseAbuseCh<T extends { query_status?: string }>(
  res: Response,
  label: string,
  okStatuses: string[],
): Promise<T> {
  let body: (T & { error?: string }) | null = null;
  try {
    body = (await res.json()) as T & { error?: string };
  } catch {
    // non-JSON body handled below
  }
  const qs = body?.query_status;
  if (!res.ok || !qs || !okStatuses.includes(qs)) {
    throw new Error(`${label}: ${qs ?? body?.error ?? `HTTP ${res.status}`}`);
  }
  return body as T;
}

// fetchSource is GET-only; ThreatFox needs a JSON POST. Same politeness
// envelope (UA, 30s timeout), no retry — the cron retries in an hour.
async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    return await fetch(url, {
      method: 'POST',
      headers: { 'User-Agent': UA, 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

// URLhaus date_added: '2026-06-11 14:23:05 UTC'.
function parseUrlhausDate(s: string | undefined): number {
  if (!s) return NaN;
  return Date.parse(s.trim().replace(' UTC', '').replace(' ', 'T') + 'Z');
}

export const sync = internalAction({
  args: {},
  handler: async (ctx) => {
    const key = process.env.ABUSECH_AUTH_KEY;
    if (!key) {
      await ctx.runMutation(internal.feeds.abusech.fail, {
        error: 'ABUSECH_AUTH_KEY not configured (see PLAN.md keys queue)',
      });
      return;
    }
    try {
      const [urlhausRes, threatfoxRes] = await Promise.all([
        fetchSource(URLHAUS_URL, { headers: { 'Auth-Key': key }, timeoutMs: 30_000 }),
        postJson(THREATFOX_URL, { 'Auth-Key': key }, { query: 'get_iocs', days: 1 }),
      ]);
      const [urlhaus, threatfox] = await Promise.all([
        parseAbuseCh<UrlhausRecent>(urlhausRes, 'urlhaus', ['ok']),
        parseAbuseCh<ThreatfoxIocs>(threatfoxRes, 'threatfox', ['ok', 'no_result']),
      ]);
      const fetchedAt = Date.now();

      const cutoff = fetchedAt - DAY_MS;
      const urlhausCount = (urlhaus.urls ?? []).filter(
        (u) => parseUrlhausDate(u.date_added) >= cutoff,
      ).length;
      const threatfoxCount = Array.isArray(threatfox.data) ? threatfox.data.length : 0;

      // 24h rolling aggregates — stamped at poll time.
      const readings: ReadingInput[] = [
        {
          stationId: STATION,
          metric: 'urlhaus_new_urls',
          value: urlhausCount,
          unit: 'count',
          at: fetchedAt,
          sourceSlug: META.slug,
        },
        {
          stationId: STATION,
          metric: 'threatfox_new_iocs',
          value: threatfoxCount,
          unit: 'count',
          at: fetchedAt,
          sourceSlug: META.slug,
        },
      ];

      await ctx.runMutation(internal.feeds.abusech.ingest, { readings });
    } catch (e) {
      await ctx.runMutation(internal.feeds.abusech.fail, { error: String(e) });
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
