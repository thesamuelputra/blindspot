import type { DerivedCandidate, RuleImpl } from '../types';

// BRIEF §8.1 seed rule: vessel matches a sanctioned identifier → flag.
//
// The sanctioned-identifier set lives in the rule's own params row
// (rules table, slug "sanctions-match", params JSON:
//   { "sanctionedMmsis": ["316001234", ...] }
// ). BrainContext deliberately carries no snapshots, so the list rides in
// with the rule config that evaluate.ts already loads every tick. The future
// opensanctions feed module (SOURCES.md, Tier 2) is expected to MAINTAIN that
// params row: refresh sanctionedMmsis from the OpenSanctions dataset on its
// own cron, and this rule picks the new list up on the next tick unchanged.
//
// Clean no-op when the list is empty or missing. Matching is exact on
// entities.extId (the MMSI for kind "vessel").
//
// Confidence basis (ARCHITECTURE §4): AIS position feed is a community
// aggregator (0.8) and an exact MMSI match carries rule confidence 1.0,
// so 0.8. MMSI spoofing exists; the rationale says to verify the entry.

const AIS_CONFIDENCE = 0.8;
const RULE_CONFIDENCE = 1.0; // exact identifier match
const CONFIDENCE = AIS_CONFIDENCE * RULE_CONFIDENCE;

export const sanctionsMatch: RuleImpl = (ctx, params) => {
  const raw = params.sanctionedMmsis;
  const mmsis = Array.isArray(raw)
    ? raw.filter((x): x is string => typeof x === 'string' && x.trim() !== '')
    : [];
  if (mmsis.length === 0) return []; // no list configured → no-op

  const sanctioned = new Set(mmsis.map((m) => m.trim()));
  const out: DerivedCandidate[] = [];

  for (const m of ctx.movers) {
    if (m.kind !== 'vessel' || !sanctioned.has(m.extId)) continue;
    out.push({
      rule: 'sanctions-match',
      title: `Sanctioned vessel in area: ${m.label}`,
      summary:
        `Vessel ${m.label} (MMSI ${m.extId}) matches the configured sanctions ` +
        `identifier list, currently near ${m.lat.toFixed(2)}, ${m.lng.toFixed(2)}.`,
      severity: 'warning',
      lat: m.lat,
      lng: m.lng,
      confidence: CONFIDENCE,
      // Movers are entities, not signals; there is no signal id to cite.
      contributingIds: [],
      rationale:
        `MMSI ${m.extId} appears on the sanctioned-identifier list configured for this ` +
        `rule. The match is exact on MMSI, but MMSI can be spoofed or reused, so verify ` +
        `the vessel against the underlying sanctions entry before acting. Confidence ` +
        `${CONFIDENCE} = AIS feed ${AIS_CONFIDENCE} x exact match ${RULE_CONFIDENCE}.`,
      // Stable per vessel: the condition persists while the vessel is in
      // area; commit patches the same signal and alerting stays edge-triggered.
      dedupeKey: `derived:sanctions-match:${m.extId}`,
      notify: true,
    });
  }

  return out;
};
