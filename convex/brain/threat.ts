import type { BrainContext, Severity } from './types';
import { distanceMeters } from '../lib/geo';

// Regional threat level (ARCHITECTURE §7.7). PURE function over BrainContext —
// no db access — so synthetic-fixture tests are trivial. The brain tick calls
// computeThreat every 8th tick (~16 min at the 120s cadence) and the commit
// mutation writes the row to the `threat` table.
//
// score = Σ severityWeight × recencyDecay × proximityWeight over active
// alerts + recent signals. world-event signals are excluded entirely: they are
// global context for the WORLD page, not Vancouver Island threats.
//
// EVERY CONSTANT BELOW IS A TUNABLE HEURISTIC, not calibrated risk math. The
// UI labels the output as a heuristic; adjust freely as the feed mix evolves.

// Severity weights: one critical outweighs two warnings outweighs five watches.
export const SEVERITY_WEIGHT: Record<Severity, number> = {
  info: 0.5,
  watch: 2,
  warning: 5,
  critical: 12,
};

// Recency: exponential decay with a 6 hour half-life on observedAt. A critical
// from 12 hours ago carries a quarter of its original weight.
export const DECAY_HALF_LIFE_MS = 6 * 3600_000;

// Proximity buckets keyed to the Island's population centers (approximate town
// centroids; the buckets are coarse enough that block-level precision is noise).
export const POPULATION_CENTERS: ReadonlyArray<{ name: string; lat: number; lng: number }> = [
  { name: 'Victoria', lat: 48.4284, lng: -123.3656 },
  { name: 'Nanaimo', lat: 49.1659, lng: -123.9401 },
  { name: 'Comox', lat: 49.6735, lng: -124.9022 },
  { name: 'Port Alberni', lat: 49.2339, lng: -124.8055 },
  { name: 'Campbell River', lat: 50.0331, lng: -125.2733 },
];
export const NEAR_KM = 25; // within this of any center: full weight
export const REGION_KM = 100; // within this of any center: half weight
const PROXIMITY_NEAR = 1.0;
const PROXIMITY_REGION = 0.5;
const PROXIMITY_FAR = 0.25; // beyond 100 km, or no usable geometry

// Level thresholds. Calibration intuition: two fresh warnings near a town
// reads ELEVATED; a fresh critical near a town plus supporting activity, or
// several criticals, reads HIGH.
export const NOMINAL_BELOW = 8;
export const ELEVATED_BELOW = 25;

// The SYSTEM page shows the top contributors, not the whole ledger.
export const FACTOR_LIMIT = 8;

export type ThreatLevel = 'NOMINAL' | 'ELEVATED' | 'HIGH';

export interface ThreatFactor {
  label: string;
  weight: number;
  signalId?: string;
}

export interface ThreatResult {
  level: ThreatLevel;
  score: number;
  factors: ThreatFactor[];
}

export function computeThreat(ctx: BrainContext): ThreatResult {
  const contributions: ThreatFactor[] = [];

  for (const s of ctx.signals) {
    // world-event = global context by definition (§4), never an Island factor
    if (s.kind === 'world-event') continue;
    const weight =
      (SEVERITY_WEIGHT[s.severity] ?? 0) *
      recencyDecay(ctx.now, s.observedAt) *
      proximityWeight(s.lat, s.lng);
    if (weight <= 0) continue;
    contributions.push({
      label: `${s.title} (${s.severity})`,
      weight: round2(weight),
      signalId: String(s._id),
    });
  }

  for (const a of ctx.alerts) {
    // loadContext already filters status=active; belt and suspenders on expiry
    if (a.expires !== undefined && a.expires <= ctx.now) continue;
    const point = alertPoint(a.area);
    const weight =
      (SEVERITY_WEIGHT[a.severity] ?? 0) *
      recencyDecay(ctx.now, a.effective) *
      proximityWeight(point?.lat, point?.lng);
    if (weight <= 0) continue;
    contributions.push({
      label: `Alert: ${a.headline} (${a.severity})`,
      weight: round2(weight),
    });
  }

  const score = round2(contributions.reduce((sum, c) => sum + c.weight, 0));
  const level: ThreatLevel =
    score < NOMINAL_BELOW ? 'NOMINAL' : score < ELEVATED_BELOW ? 'ELEVATED' : 'HIGH';
  const factors = [...contributions]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, FACTOR_LIMIT);

  return { level, score, factors };
}

// Exported for fixture tests.
export function recencyDecay(now: number, observedAt: number): number {
  const age = now - observedAt;
  if (age <= 0) return 1; // clock skew or future-dated upstream: no boost, no penalty
  return Math.pow(0.5, age / DECAY_HALF_LIFE_MS);
}

// Exported for fixture tests.
export function proximityWeight(lat?: number, lng?: number): number {
  if (lat === undefined || lng === undefined) return PROXIMITY_FAR;
  let minKm = Infinity;
  for (const c of POPULATION_CENTERS) {
    const km = distanceMeters(lat, lng, c.lat, c.lng) / 1000;
    if (km < minKm) minKm = km;
  }
  if (minKm <= NEAR_KM) return PROXIMITY_NEAR;
  if (minKm <= REGION_KM) return PROXIMITY_REGION;
  return PROXIMITY_FAR;
}

// CAP alert areas are stringified GeoJSON. A crude vertex average is enough to
// pick a 25/100 km proximity bucket; a true centroid buys nothing here.
function alertPoint(area?: string): { lat: number; lng: number } | undefined {
  if (!area) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(area);
  } catch {
    return undefined;
  }
  const points: Array<[number, number]> = [];
  collectPositions(parsed, points);
  if (points.length === 0) return undefined;
  const lng = points.reduce((sum, p) => sum + p[0], 0) / points.length;
  const lat = points.reduce((sum, p) => sum + p[1], 0) / points.length;
  return { lat, lng };
}

// Walk any GeoJSON shape (Feature, FeatureCollection, bare geometry) and
// collect [lng, lat] positions.
function collectPositions(node: unknown, out: Array<[number, number]>): void {
  if (!node) return;
  if (Array.isArray(node)) {
    if (node.length >= 2 && typeof node[0] === 'number' && typeof node[1] === 'number') {
      out.push([node[0], node[1]]);
      return;
    }
    for (const child of node) collectPositions(child, out);
    return;
  }
  if (typeof node === 'object') {
    const o = node as Record<string, unknown>;
    if (o.coordinates) collectPositions(o.coordinates, out);
    if (o.geometry) collectPositions(o.geometry, out);
    if (o.features) collectPositions(o.features, out);
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
