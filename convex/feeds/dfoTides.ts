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
import { writeSnapshot } from '../lib/movers';

// dfo-chs-tides — SOURCES.md: Seas (Marine). DFO/CHS IWLS REST API, no auth.
// Per station: latest observed water level (wlo, 1-min series, few-minute
// ingestion lag) → metric 'water_level', plus next 24h of predictions (wlp,
// server-side resolution=FIFTEEN_MINUTES — verified live 2026-06-11) →
// metric 'water_level_pred' at future timestamps. Values are metres above
// chart datum. Worst case ~588 readings/sync (6 × (1 wlo + 97 wlp)), mostly
// deduped on re-poll by (stationId, metric, at). Cadence: medium lane (600s).
const META: SourceMeta = {
  slug: 'dfo-chs-tides',
  name: 'DFO/CHS Water Levels (IWLS)',
  cluster: 'Seas (Marine)',
  cadenceSec: 600,
  attribution: 'Canadian Hydrographic Service / Fisheries and Oceans Canada',
};

const API = 'https://api-iwls.dfo-mpo.gc.ca/api/v1';

// Data URLs need the Mongo-style station id, NOT the 5-digit CHS code
// (SOURCES.md gotcha). Ids + coordinates verified live 2026-06-11, all
// operating:true with wlo+wlp time series.
const STATIONS = [
  { id: '5cebf1df3d0f4a073c4bbd1e', code: '07120', name: 'Victoria Harbour', lat: 48.424363, lng: -123.370828 },
  { id: '5cebf1de3d0f4a073c4bb96d', code: '07917', name: 'Nanaimo Harbour', lat: 49.1628, lng: -123.9235 },
  { id: '5cebf1de3d0f4a073c4bb996', code: '08074', name: 'Campbell River', lat: 50.042, lng: -125.247 },
  { id: '5cebf1e23d0f4a073c4bc07c', code: '08615', name: 'Tofino', lat: 49.154, lng: -125.913 },
  { id: '5cebf1de3d0f4a073c4bb9c7', code: '08408', name: 'Port Hardy', lat: 50.722, lng: -127.489 },
  { id: '5cebf1e23d0f4a073c4bc06f', code: '08575', name: 'Port Alberni', lat: 49.225621, lng: -124.813613 },
] as const;

const HOUR = 3600 * 1000;
const PRED_HORIZON_MS = 24 * HOUR; // cap predictions ~24h ahead
const OBS_LOOKBACK_MS = 2 * HOUR; // small from/to windows per SOURCES.md

interface IwlsDatum {
  eventDate: string; // '2026-06-11T10:00:00Z'
  qcFlagCode?: string;
  reviewed?: boolean;
  timeSeriesId: string;
  value: number; // metres, chart datum
}

// API accepts ms-precision ISO too (verified), but keep the documented shape.
const iso = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

async function fetchSeries(
  stationId: string,
  tsCode: 'wlo' | 'wlp',
  fromMs: number,
  toMs: number,
  resolution?: string,
): Promise<IwlsDatum[]> {
  const url =
    `${API}/stations/${stationId}/data?time-series-code=${tsCode}` +
    `&from=${iso(fromMs)}&to=${iso(toMs)}` +
    (resolution ? `&resolution=${resolution}` : '');
  const res = await fetchSource(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} (${tsCode})`);
  return (await res.json()) as IwlsDatum[];
}

export const sync = internalAction({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const readings: ReadingInput[] = [];
    const snapshot: Array<{
      id: string;
      label: string;
      lat: number;
      lng: number;
      value: number;
      unit: string;
      at: number;
    }> = [];
    const errors: string[] = [];

    for (const s of STATIONS) {
      const stationId = `${META.slug}:${s.code}`;
      try {
        // Latest observation: trailing window, take newest row (don't trust
        // upstream ordering).
        const wlo = await fetchSeries(s.id, 'wlo', now - OBS_LOOKBACK_MS, now);
        const latest = wlo.reduce<{ at: number; value: number } | null>((best, d) => {
          const at = Date.parse(d.eventDate);
          return Number.isFinite(at) && typeof d.value === 'number' && (!best || at > best.at)
            ? { at, value: d.value }
            : best;
        }, null);
        if (latest) {
          readings.push({
            stationId,
            metric: 'water_level',
            value: latest.value,
            unit: 'm',
            at: latest.at,
            lat: s.lat,
            lng: s.lng,
            sourceSlug: META.slug,
          });
          snapshot.push({
            id: s.code,
            label: s.name,
            lat: s.lat,
            lng: s.lng,
            value: latest.value,
            unit: 'm',
            at: latest.at,
          });
        }

        // Predictions: next 24h, 15-min ticks at future timestamps.
        const wlp = await fetchSeries(s.id, 'wlp', now, now + PRED_HORIZON_MS, 'FIFTEEN_MINUTES');
        for (const p of wlp) {
          const at = Date.parse(p.eventDate);
          if (!Number.isFinite(at) || typeof p.value !== 'number') continue;
          readings.push({
            stationId,
            metric: 'water_level_pred',
            value: p.value,
            unit: 'm',
            at,
            lat: s.lat,
            lng: s.lng,
            sourceSlug: META.slug,
          });
        }
      } catch (e) {
        errors.push(`${s.code} ${s.name}: ${String(e)}`);
      }
    }

    // Partial success is success (per-station failures noted in the count);
    // only an all-stations wipeout marks the source stale/down.
    if (snapshot.length === 0) {
      await ctx.runMutation(internal.feeds.dfoTides.fail, {
        error: errors.join('; ') || 'no observed water levels returned',
      });
      return;
    }
    await ctx.runMutation(internal.feeds.dfoTides.ingest, {
      readings,
      snapshotJson: JSON.stringify(snapshot),
    });
  },
});

export const ingest = internalMutation({
  args: { readings: v.array(v.any()), snapshotJson: v.string() },
  handler: async (ctx, { readings, snapshotJson }) => {
    const inserted = await insertReadings(ctx, readings as ReadingInput[]);
    await writeSnapshot(ctx, `stations:${META.slug}`, snapshotJson);
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
