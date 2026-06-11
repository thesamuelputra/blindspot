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

// ioda — SOURCES.md: Infrastructure / Network / Cyber. IODA (Internet Outage
// Detection & Analysis, Georgia Tech) country-level connectivity for Canada.
// No auth. Two calls per sync (the raw-signals endpoint returns EVERY
// datasource in one response when the datasource param is omitted — verified
// live 2026-06-11 — so this is politer than the catalog's one-call-per-
// datasource budget):
//   /v2/signals/raw/country/CA  → readings, latest non-null sample of the
//     three documented numeric datasources (bgp 300s step, ping-slash24 600s,
//     merit-nt 300s). The same response also carries gtr/gtr-norm/mozilla and
//     dict-valued ping-slash24-loss/-latency series — ignored (not in the
//     catalog's documented set; some are not scalar).
//   /v2/outages/events?entityType=country&entityCode=CA  → signals kind
//     'anomaly', severity 'watch', one per detected outage event in the last
//     24h. Verified event shape (sampled globally; CA was quiet = data:[]):
//     {location:'geoasn/140224-SG', start, duration (s), method, datasource,
//     score, location_name, overlaps_window}. Empty data in fair weather is
//     success with count 0.
// Sample timestamps reconstruct as from + i*step (unix seconds); trailing
// nulls mean 'not yet published' (~15-30 min lag), never an outage.
// Confidence 0.6: IODA outage events are algorithmic detections
// (aggregated/modeled), not agency-confirmed incidents.
// Non-geographic source — no lat/lng/cell anywhere, no map layer, no
// snapshot (INFRASTRUCTURE page consumes the series in Phase 5).
// Worst case: 3 readings + a handful of event signals per sync.
// Cadence: medium lane (900s; signal step is 300s and the tail lags anyway).
const META: SourceMeta = {
  slug: 'ioda',
  name: 'IODA internet outage signals (Canada)',
  cluster: 'Infrastructure / Network / Cyber',
  cadenceSec: 900,
  attribution: 'IODA, Internet Intelligence Lab, Georgia Tech',
  licenseNote:
    'Responses carry a Georgia Tech Research Corporation copyright — attribute clearly; confirm terms before republishing raw series',
};

const API = 'https://api.ioda.inetintel.cc.gatech.edu/v2';
const STATION = `${META.slug}:ca`;

// Documented numeric datasources → our metric vocabulary (snake_case).
const DATASOURCES: Record<string, { metric: string; unit: string }> = {
  bgp: { metric: 'ioda_bgp', unit: '/24s' }, // BGP-visible /24 blocks
  'ping-slash24': { metric: 'ioda_ping_slash24', unit: '/24s' }, // responsive /24 blocks
  'merit-nt': { metric: 'ioda_merit_nt', unit: 'src IPs' }, // darknet unique sources
};

const SIGNALS_WINDOW_SEC = 6 * 3600; // enough to find the last published sample
const EVENTS_WINDOW_SEC = 24 * 3600;
const EVENT_LINGER_MS = 24 * 3600 * 1000; // keep resolved events visible a day

interface IodaSeries {
  entityType?: string;
  entityCode?: string;
  datasource?: string;
  from?: number; // unix seconds
  step?: number; // seconds
  values?: Array<number | null | unknown>; // some datasources carry dicts
}

interface IodaSignalsResponse {
  error?: string | null;
  data?: IodaSeries[][];
}

interface IodaEvent {
  location?: string; // e.g. 'country/CA'
  start?: number; // unix seconds
  duration?: number; // seconds
  method?: string;
  datasource?: string;
  score?: number;
  location_name?: string;
  overlaps_window?: boolean;
}

interface IodaEventsResponse {
  error?: string | null;
  data?: IodaEvent[];
}

async function iodaJson<T extends { error?: string | null }>(
  url: string,
  label: string,
): Promise<T> {
  const res = await fetchSource(url, { timeoutMs: 45_000 });
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status}`);
  const body = (await res.json()) as T;
  if (body.error) throw new Error(`${label}: ${body.error}`);
  return body;
}

// Latest finite sample scanning backwards — trailing nulls are publication lag.
function latestSample(s: IodaSeries): { value: number; at: number } | null {
  const { from, step, values } = s;
  if (typeof from !== 'number' || typeof step !== 'number' || !Array.isArray(values)) return null;
  for (let i = values.length - 1; i >= 0; i--) {
    const value = values[i];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return { value, at: (from + i * step) * 1000 };
    }
  }
  return null;
}

export const sync = internalAction({
  args: {},
  handler: async (ctx) => {
    const nowSec = Math.floor(Date.now() / 1000);
    const signalsUrl = `${API}/signals/raw/country/CA?from=${nowSec - SIGNALS_WINDOW_SEC}&until=${nowSec}`;
    const eventsUrl =
      `${API}/outages/events?entityType=country&entityCode=CA` +
      `&from=${nowSec - EVENTS_WINDOW_SEC}&until=${nowSec}`;
    try {
      const [seriesBody, eventsBody] = await Promise.all([
        iodaJson<IodaSignalsResponse>(signalsUrl, 'signals/raw'),
        iodaJson<IodaEventsResponse>(eventsUrl, 'outages/events'),
      ]);
      const fetchedAt = Date.now();

      // ---- readings: latest published sample per documented datasource ----
      const readings: ReadingInput[] = [];
      for (const group of seriesBody.data ?? []) {
        for (const series of group) {
          const mapped = DATASOURCES[series.datasource ?? ''];
          if (!mapped) continue;
          const sample = latestSample(series);
          if (!sample) continue;
          readings.push({
            stationId: STATION,
            metric: mapped.metric,
            value: sample.value,
            unit: mapped.unit,
            at: sample.at,
            sourceSlug: META.slug,
          });
        }
      }

      // ---- signals: detected outage events for Canada ----
      const signals: SignalInput[] = [];
      for (const e of eventsBody.data ?? []) {
        if (typeof e.start !== 'number') continue;
        const startMs = e.start * 1000;
        const endMs = startMs + (typeof e.duration === 'number' ? e.duration : 0) * 1000;
        const where = e.location_name ?? 'Canada';
        signals.push({
          sourceSlug: META.slug,
          kind: 'anomaly',
          title: `IODA outage detected: ${where} (${e.datasource ?? 'unknown datasource'})`.slice(0, 140),
          summary: [
            `Connectivity drop detected by IODA ${e.datasource ?? '?'}/${e.method ?? '?'}`,
            typeof e.duration === 'number' ? `duration ${(e.duration / 3600).toFixed(1)} h` : null,
            typeof e.score === 'number' ? `score ${Math.round(e.score)}` : null,
          ]
            .filter(Boolean)
            .join(', ')
            .slice(0, 300),
          severity: 'watch',
          // non-geographic signal — no lat/lng/cell
          observedAt: startMs,
          expiresAt: endMs + EVENT_LINGER_MS,
          dedupeKey: `${META.slug}:${e.location ?? 'country/CA'}:${e.start}`,
          confidence: 0.6, // algorithmic outage detection (aggregated/modeled)
          provenance: JSON.stringify({
            method: 'poll',
            fetchedAt,
            upstreamId: `${e.location ?? 'country/CA'}:${e.start}`,
            url: eventsUrl,
          }),
          raw: JSON.stringify(e).slice(0, 2000),
        });
      }

      await ctx.runMutation(internal.feeds.ioda.ingest, { readings, signals });
    } catch (e) {
      await ctx.runMutation(internal.feeds.ioda.fail, { error: String(e) });
    }
  },
});

export const ingest = internalMutation({
  args: { readings: v.array(v.any()), signals: v.array(v.any()) },
  handler: async (ctx, { readings, signals }) => {
    await insertReadings(ctx, readings as ReadingInput[]);
    const { inserted, updated } = await upsertSignals(ctx, signals as SignalInput[]);
    await reportSuccess(ctx, META, readings.length + signals.length);
    return { inserted, updated };
  },
});

export const fail = internalMutation({
  args: { error: v.string() },
  handler: async (ctx, { error }) => {
    await reportFailure(ctx, META, error);
  },
});
