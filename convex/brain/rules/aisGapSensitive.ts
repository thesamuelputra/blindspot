import type { DerivedCandidate, RuleImpl } from '../types';

// BRIEF §8.1 seed rule: AIS gap on a watched vessel → flag.
//
// HEALTH-GATED (ARCHITECTURE §7.3): only evaluated while the aisstream
// source row reports status "live". When the worker is down or stale, every
// vessel "disappears" at once and absence means nothing; the gate prevents
// mass false anomalies.
//
// Detection: active watchlist entries of kind "vessel" whose MMSI
// (watchlist.identifier) has no matching fresh mover (ctx.movers carries
// entities with lastSeenAt within 10 min, loaded by the brain tick). The
// fresh-mover set is the only position state in BrainContext, so a vessel
// with a gap has, by construction, no last position available here: no
// dead-reckoning is attempted and the copy says the gap duration is unknown
// rather than inventing one. Dead-reckoned gap positions belong to the
// anomaly evaluator with tracks access (§7.3/§7.9).
//
// Dedupe: per vessel per 6 hour bucket, so a continuing gap re-surfaces a
// few times a day instead of every 120 s tick.
//
// Confidence 0.6: absence-based inference over a live but beta feed; the
// vessel may simply be outside the bbox or thinned out of a batch.

const SIX_HOURS_MS = 6 * 3600_000;
const CONFIDENCE = 0.6;

export const aisGapSensitive: RuleImpl = (ctx) => {
  const ais = ctx.sources.find((s) => s.slug === 'aisstream');
  if (!ais || ais.status !== 'live') return []; // health gate

  const freshVessels = new Set(
    ctx.movers.filter((m) => m.kind === 'vessel').map((m) => m.extId),
  );

  const out: DerivedCandidate[] = [];
  const bucket = Math.floor(ctx.now / SIX_HOURS_MS);

  for (const w of ctx.watchlist) {
    if (w.kind !== 'vessel' || !w.active) continue;
    if (freshVessels.has(w.identifier)) continue;

    out.push({
      rule: 'ais-gap-sensitive',
      title: `AIS gap on watched vessel ${w.label}`,
      summary:
        `Watched vessel ${w.label} (MMSI ${w.identifier}) is absent from the fresh AIS ` +
        `picture while the AIS feed itself is live. Gap duration unknown from this check.`,
      severity: 'watch',
      // No position: the fresh mover set is the only position state available
      // to this rule, and this vessel is not in it.
      confidence: CONFIDENCE,
      // The gap is inferred from entity absence, not from any signal.
      contributingIds: [],
      rationale:
        `MMSI ${w.identifier} is on the watchlist but no position for it arrived in the ` +
        `last 10 minutes, while the aisstream source reports live, so the silence is the ` +
        `vessel, not the pipe. This check cannot see the last known position or how long ` +
        `the gap has lasted; it only knows the vessel is missing from the current picture. ` +
        `It may have left the coverage box or stopped transmitting. Confidence ${CONFIDENCE} ` +
        `reflects absence-based inference.`,
      dedupeKey: `derived:ais-gap-sensitive:${w.identifier}:${bucket}`,
    });
  }

  return out;
};
