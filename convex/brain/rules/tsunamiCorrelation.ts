import type { Doc } from '../../_generated/dataModel';
import type { DerivedCandidate, RuleImpl } from '../types';

// BRIEF §8.1 seed rule: offshore quake + tide-gauge anomaly (+ ONC seafloor
// pressure spike when present) → tsunami correlation, severity critical.
// Partial evidence (major offshore quake alone) → watch-level evaluation.
//
// Pure function over BrainContext. Inputs it reads:
//  - ctx.signals kind "earthquake" (usgs-quakes / nrcan-quakes both store
//    raw JSON as {mag, depthKm}) within the recent window;
//  - ctx.readings metric "water_level" (DFO tides / ECCC hydrometric, metres)
//    and metric "seafloor_pressure" (ONC Oceans, dbar; 1 dbar ≈ 1 m of water).
//
// "Offshore" heuristic: lng < -125.5 puts the epicentre on the Cascadia
// margin west of the Island. A shallow quake (depth ≤ 35 km) elsewhere in the
// box can still displace water in the strait system, so shallow also
// qualifies; we accept that false-positive cost because the output is an
// evaluation trigger, not a warning product.
//
// Confidence basis (ARCHITECTURE §4: product of contributors × rule
// confidence): quake signal confidence (1.0, USGS/NRCan) × gauge instrument
// confidence (1.0, DFO/ECCC/ONC) × rule confidence 0.85, raised to 0.95 when
// a seafloor pressure spike corroborates. Partial evidence: quake × 0.5.
//
// Params (rules table JSON): magThreshold (default 6), levelDeltaM (default
// 0.5 m), pressureDeltaDbar (default 0.5), quakeWindowMin (default 90).

const OFFSHORE_LNG = -125.5;
const SHALLOW_DEPTH_KM = 35;
const PARTIAL_MAG = 7; // quake-only evaluation threshold
const RULE_CONF = 0.85;
const RULE_CONF_WITH_PRESSURE = 0.95;
const PARTIAL_RULE_CONF = 0.5;
const GAUGE_CONF = 1.0; // authoritative instruments (DFO/ECCC/ONC)
const MIN_LAG_MS = 30 * 60_000;
const MAX_LAG_MS = 60 * 60_000;
const TARGET_LAG_MS = 45 * 60_000;

interface QuakeRaw {
  mag?: number;
  depthKm?: number | null;
}

interface StationDelta {
  stationId: string;
  delta: number; // latest value minus the 30-60 min earlier value
  at: number;
}

// Per station: latest reading vs the reading 30-60 min earlier (closest to
// 45 min when several qualify). Stations without a reference pair are skipped.
function stationDeltas(readings: Doc<'readings'>[], metric: string): StationDelta[] {
  const byStation = new Map<string, Doc<'readings'>[]>();
  for (const r of readings) {
    if (r.metric !== metric) continue;
    const rows = byStation.get(r.stationId);
    if (rows) rows.push(r);
    else byStation.set(r.stationId, [r]);
  }
  const out: StationDelta[] = [];
  for (const [stationId, rows] of byStation) {
    const latest = rows.reduce((a, b) => (b.at > a.at ? b : a));
    let ref: Doc<'readings'> | undefined;
    let bestScore = Infinity;
    for (const r of rows) {
      const lag = latest.at - r.at;
      if (lag < MIN_LAG_MS || lag > MAX_LAG_MS) continue;
      const score = Math.abs(lag - TARGET_LAG_MS);
      if (score < bestScore) {
        bestScore = score;
        ref = r;
      }
    }
    if (!ref) continue;
    out.push({ stationId, delta: latest.value - ref.value, at: latest.at });
  }
  return out;
}

export const tsunamiCorrelation: RuleImpl = (ctx, params) => {
  const magThreshold = typeof params.magThreshold === 'number' ? params.magThreshold : 6;
  const levelDeltaM = typeof params.levelDeltaM === 'number' ? params.levelDeltaM : 0.5;
  const pressureDeltaDbar =
    typeof params.pressureDeltaDbar === 'number' ? params.pressureDeltaDbar : 0.5;
  const quakeWindowMin = typeof params.quakeWindowMin === 'number' ? params.quakeWindowMin : 90;
  const windowStart = ctx.now - quakeWindowMin * 60_000;

  // Qualifying quakes in the window, strongest first.
  const quakes = ctx.signals
    .filter((s) => s.kind === 'earthquake' && s.observedAt >= windowStart)
    .map((s) => {
      let raw: QuakeRaw = {};
      try {
        raw = s.raw ? (JSON.parse(s.raw) as QuakeRaw) : {};
      } catch {
        /* unreadable raw → skip via mag check below */
      }
      return { signal: s, mag: raw.mag, depthKm: raw.depthKm };
    })
    .filter(
      (q) =>
        typeof q.mag === 'number' &&
        q.mag >= magThreshold &&
        typeof q.signal.lng === 'number' &&
        typeof q.signal.lat === 'number' &&
        (q.signal.lng < OFFSHORE_LNG ||
          (typeof q.depthKm === 'number' && q.depthKm <= SHALLOW_DEPTH_KM)),
    )
    .sort((a, b) => (b.mag ?? 0) - (a.mag ?? 0));

  if (quakes.length === 0) return [];
  const quake = quakes[0];
  const mag = quake.mag ?? 0;
  const sig = quake.signal;

  const levelAnomalies = stationDeltas(ctx.readings, 'water_level').filter(
    (d) => Math.abs(d.delta) > levelDeltaM,
  );
  const pressureSpikes = stationDeltas(ctx.readings, 'seafloor_pressure').filter(
    (d) => Math.abs(d.delta) > pressureDeltaDbar,
  );

  const out: DerivedCandidate[] = [];

  if (levelAnomalies.length > 0) {
    // Full correlation: quake + gauge anomaly (+ pressure when present).
    const gauge = levelAnomalies.reduce((a, b) =>
      Math.abs(b.delta) > Math.abs(a.delta) ? b : a,
    );
    const corroborated = pressureSpikes.length > 0;
    const ruleConf = corroborated ? RULE_CONF_WITH_PRESSURE : RULE_CONF;
    const confidence = Math.round(sig.confidence * GAUGE_CONF * ruleConf * 100) / 100;
    const pressureLine = corroborated
      ? ` Seafloor pressure at ${pressureSpikes[0].stationId} also moved ${Math.abs(
          pressureSpikes[0].delta,
        ).toFixed(2)} dbar over the same window.`
      : '';
    out.push({
      rule: 'tsunami-correlation',
      title: `Possible tsunami signature: M${mag.toFixed(1)} quake plus water level anomaly`,
      summary:
        `M${mag.toFixed(1)} earthquake near ${sig.lat?.toFixed(2)}, ${sig.lng?.toFixed(2)}` +
        ` in the last ${quakeWindowMin} min. Tide gauge ${gauge.stationId} shifted ` +
        `${Math.abs(gauge.delta).toFixed(2)} m versus its reading 30 to 60 min earlier.` +
        pressureLine,
      severity: 'critical',
      lat: sig.lat,
      lng: sig.lng,
      confidence,
      contributingIds: [String(sig._id)],
      rationale:
        `An offshore or shallow M${mag.toFixed(1)} earthquake correlated with a coastal ` +
        `water level change of ${Math.abs(gauge.delta).toFixed(2)} m at ${gauge.stationId} ` +
        `(threshold ${levelDeltaM} m, compared against the same station 30 to 60 minutes earlier).` +
        pressureLine +
        ` Confidence ${confidence} is the product of quake confidence ${sig.confidence}, ` +
        `gauge confidence ${GAUGE_CONF} and rule confidence ${ruleConf}. ` +
        `This is a correlation, not an official tsunami product. Check NTWC.`,
      // Stable per quake: a persisting condition patches the same signal.
      dedupeKey: `derived:tsunami-correlation:${String(sig._id)}`,
      notify: true,
    });
  } else if (mag >= PARTIAL_MAG) {
    // Partial evidence: major quake, gauges quiet (or not yet showing it).
    const confidence = Math.round(sig.confidence * PARTIAL_RULE_CONF * 100) / 100;
    out.push({
      rule: 'tsunami-correlation',
      title: `Tsunami evaluation: M${mag.toFixed(1)} offshore quake, gauges quiet so far`,
      summary:
        `M${mag.toFixed(1)} earthquake near ${sig.lat?.toFixed(2)}, ${sig.lng?.toFixed(2)}. ` +
        `No coastal water level anomaly above ${levelDeltaM} m yet. Watch tide gauges.`,
      severity: 'watch',
      lat: sig.lat,
      lng: sig.lng,
      confidence,
      contributingIds: [String(sig._id)],
      rationale:
        `A magnitude ${mag.toFixed(1)} quake at this location is large enough to warrant a ` +
        `tsunami evaluation on its own, but no tide gauge has deviated more than ` +
        `${levelDeltaM} m from its level 30 to 60 minutes earlier. Confidence ${confidence} ` +
        `reflects single-source partial evidence (quake ${sig.confidence} x rule ${PARTIAL_RULE_CONF}). ` +
        `Check NTWC for the official assessment.`,
      // Distinct key from the full correlation so an escalation from
      // evaluation to confirmed correlation notifies fresh (commit is
      // edge-triggered per dedupeKey).
      dedupeKey: `derived:tsunami-correlation:eval:${String(sig._id)}`,
      notify: true,
    });
  }

  return out;
};
