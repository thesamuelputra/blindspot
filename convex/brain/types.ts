// Brain contracts (ARCHITECTURE §7). Rules are PURE functions over BrainContext
// — no ctx access — so synthetic-fixture tests are trivial (Phase 6 gate).
import type { Doc } from '../_generated/dataModel';

export interface BrainContext {
  now: number;
  // recent signals by kind (capped per kind in loadContext)
  signals: Doc<'signals'>[];
  // active CAP-grade alerts
  alerts: Doc<'alerts'>[];
  // fresh movers (lastSeenAt within 10 min)
  movers: Doc<'entities'>[];
  // recent readings, newest-first, capped (for correlation rules)
  readings: Doc<'readings'>[];
  // active fences + their per-entity states
  fences: Doc<'geofences'>[];
  fenceStates: Doc<'geofenceStates'>[];
  watchlist: Doc<'watchlist'>[];
  // rule configs from the rules table, keyed by slug
  ruleParams: Record<string, { params: string; severity: Severity; active: boolean }>;
  // source health (for health-gated rules like ais-gap)
  sources: Doc<'sources'>[];
}

export type Severity = 'info' | 'watch' | 'warning' | 'critical';

export interface DerivedCandidate {
  rule: string; // rule slug
  title: string;
  summary: string;
  severity: Severity;
  lat?: number;
  lng?: number;
  geojson?: string;
  confidence: number;
  contributingIds: string[]; // signal _ids (as strings) feeding this conclusion
  rationale: string;
  dedupeKey: string; // "derived:<rule>:<stable hash of contributors>"
  notify?: boolean; // request alerting fan-out
}

export interface FenceStateChange {
  fenceId: string;
  entityId: string;
  insideSince?: number;
  lastInside: boolean;
  lastFiredAt?: number;
}

export type RuleImpl = (ctx: BrainContext, params: Record<string, unknown>) => DerivedCandidate[];
