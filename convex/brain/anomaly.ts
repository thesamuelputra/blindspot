import type { Doc } from '../_generated/dataModel';
import type { BrainContext, DerivedCandidate } from './types';

// Anomaly detection (ARCHITECTURE §7.3) — PURE function over BrainContext +
// the baselines table (passed as a second arg, fetched in evaluate.ts; see
// the wiring note in this capability's handoff). No ctx.db access here, so
// synthetic-fixture tests are trivial.
//
// Checks, all gated on z-score > 3 against the 7d baseline:
//   1. current mover counts (aircraft/vessel/bus) vs count:* baselines
//   2. latest aqhi reading per station vs its aqhi:<stationId> baseline
//   3. earthquake-signal count over the last 6h vs the rate:quakes baseline,
//      only if that baseline exists (brain/baselines.ts does not compute it
//      in v1, so this stays silent until something writes it)
//
// Quiet-by-design guards: baselines with n < 20 samples or near-zero stddev
// are ignored (a flat series makes every blip "infinite sigma"). Only spikes
// fire (signed z > 3); drops to zero are a source-health story, not an
// anomaly story. Confidence is fixed at 0.6 (modeled, per ARCHITECTURE §4).
// An optional `anomaly` row in the rules table can disable the whole pass or
// tune the threshold via params {"zThreshold": number}.

const DEFAULT_Z_THRESHOLD = 3;
const MIN_BASELINE_SAMPLES = 20;
const MIN_STDDEV = 1e-6;
const QUAKE_WINDOW_MS = 6 * 3600_000;
const COUNT_KINDS = ['aircraft', 'vessel', 'bus'] as const;
const CONFIDENCE = 0.6;

function zScore(value: number, b: Doc<'baselines'>): number | null {
  if (b.n < MIN_BASELINE_SAMPLES) return null;
  if (b.stddev < MIN_STDDEV) return null;
  return (value - b.mean) / b.stddev;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

export function evaluateAnomalies(
  ctx: BrainContext,
  baselines: Doc<'baselines'>[],
): DerivedCandidate[] {
  const config = ctx.ruleParams['anomaly'];
  if (config && !config.active) return [];
  let zThreshold = DEFAULT_Z_THRESHOLD;
  if (config) {
    try {
      const p = JSON.parse(config.params) as { zThreshold?: number };
      if (typeof p.zThreshold === 'number' && p.zThreshold > 0) zThreshold = p.zThreshold;
    } catch {
      /* bad params JSON -> default threshold */
    }
  }

  const byMetric = new Map<string, Doc<'baselines'>>();
  for (const b of baselines) byMetric.set(b.metric, b);

  const day = new Date(ctx.now).toISOString().slice(0, 10);
  const out: DerivedCandidate[] = [];

  // 1. mover counts vs count:* baselines
  for (const kind of COUNT_KINDS) {
    const baseline = byMetric.get(`count:${kind}`);
    if (!baseline) continue;
    const count = ctx.movers.filter((m) => m.kind === kind).length;
    const z = zScore(count, baseline);
    if (z === null || z <= zThreshold) continue;
    out.push({
      rule: 'anomaly-count',
      title: `Unusual ${kind} activity`,
      summary: `Unusual ${kind} activity (${count} vs typical ${r1(baseline.mean)})`,
      severity: 'watch',
      confidence: CONFIDENCE,
      contributingIds: [],
      rationale:
        `There are ${count} ${kind} movers reporting right now. ` +
        `The 7 day baseline is ${r1(baseline.mean)} with a standard deviation of ${r1(baseline.stddev)}, ` +
        `which puts the current count ${r1(z)} standard deviations above typical (threshold ${zThreshold}).`,
      dedupeKey: `derived:anomaly-count:${kind}:${day}`,
      notify: true,
    });
  }

  // 2. latest aqhi reading per station vs its station baseline
  const latestAqhi = new Map<string, Doc<'readings'>>();
  for (const r of ctx.readings) {
    if (r.metric !== 'aqhi') continue;
    const prev = latestAqhi.get(r.stationId);
    if (!prev || r.at > prev.at) latestAqhi.set(r.stationId, r);
  }
  for (const [stationId, reading] of latestAqhi) {
    const baseline = byMetric.get(`aqhi:${stationId}`);
    if (!baseline) continue;
    const z = zScore(reading.value, baseline);
    if (z === null || z <= zThreshold) continue;
    // stationId is "<sourceSlug>:<station id>"; show the part after the slug
    const colon = stationId.indexOf(':');
    const stationLabel = colon >= 0 ? stationId.slice(colon + 1) : stationId;
    out.push({
      rule: 'anomaly-aqhi',
      title: `AQHI spike at ${stationLabel}`,
      summary: `AQHI is ${r1(reading.value)} at ${stationLabel}, typical is ${r1(baseline.mean)}`,
      severity: 'watch',
      lat: reading.lat,
      lng: reading.lng,
      confidence: CONFIDENCE,
      contributingIds: [],
      rationale:
        `Station ${stationLabel} reports AQHI ${r1(reading.value)}. ` +
        `Its 7 day baseline is ${r1(baseline.mean)} with a standard deviation of ${r1(baseline.stddev)}, ` +
        `so this reading is ${r1(z)} standard deviations above typical (threshold ${zThreshold}).`,
      dedupeKey: `derived:anomaly-aqhi:${stationId}:${day}`,
      notify: true,
    });
  }

  // 3. quake rate over the last 6h vs rate:quakes baseline, if present
  const rateBaseline = byMetric.get('rate:quakes');
  if (rateBaseline) {
    const quakes = ctx.signals.filter(
      (s) => s.kind === 'earthquake' && s.observedAt >= ctx.now - QUAKE_WINDOW_MS,
    );
    const z = zScore(quakes.length, rateBaseline);
    if (z !== null && z > zThreshold) {
      // centroid of located quakes, for the map pulse
      const located = quakes.filter((q) => q.lat !== undefined && q.lng !== undefined);
      const lat = located.length
        ? located.reduce((a, q) => a + (q.lat as number), 0) / located.length
        : undefined;
      const lng = located.length
        ? located.reduce((a, q) => a + (q.lng as number), 0) / located.length
        : undefined;
      out.push({
        rule: 'anomaly-quakes',
        title: 'Possible seismic swarm',
        summary: `${quakes.length} earthquakes in the last 6 hours vs typical ${r1(rateBaseline.mean)}`,
        severity: 'watch',
        lat,
        lng,
        confidence: CONFIDENCE,
        contributingIds: quakes.map((q) => String(q._id)),
        rationale:
          `${quakes.length} earthquake signals arrived in the last 6 hours. ` +
          `The baseline rate is ${r1(rateBaseline.mean)} per 6 hours with a standard deviation of ${r1(rateBaseline.stddev)}, ` +
          `so the current rate is ${r1(z)} standard deviations above typical (threshold ${zThreshold}).`,
        dedupeKey: `derived:anomaly-quakes:${day}`,
        notify: true,
      });
    }
  }

  return out;
}
