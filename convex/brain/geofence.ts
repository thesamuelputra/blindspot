import { booleanPointInPolygon } from '@turf/turf';
import type { MultiPolygon, Polygon } from 'geojson';
import type { Doc } from '../_generated/dataModel';
import type { BrainContext, DerivedCandidate } from './types';

// Geofence tripwires (ARCHITECTURE §7.2). Pure function over BrainContext —
// no db access — so fixture tests are trivial. The brain tick calls
// evaluateGeofences and commits the returned state changes (patch-or-insert
// geofenceStates by fenceId+entityId; fireNow → stamp lastFiredAt).
//
// Transition model per fence x entity:
//   enter  — was outside (or unseen), now inside        → fires when rule=enter
//   exit   — was inside, now outside                    → fires when rule=exit
//   stale  — was inside, absent from fresh movers       → treated as exit
//            (clears insideSince; otherwise a vessel that goes dark inside a
//            fence never exits and spuriously "dwells" when it reappears)
//   dwell  — inside continuously for dwellSec           → fires once per stay
//            (guard: lastFiredAt >= insideSince blocks re-fire every tick)

export interface GeofenceStateChange {
  fenceId: string;
  entityId: string;
  insideSince?: number;
  lastInside: boolean;
  fireNow: boolean;
}

export interface GeofenceResult {
  derived: DerivedCandidate[];
  stateChanges: GeofenceStateChange[];
}

// Pull a Polygon/MultiPolygon out of whatever GeoJSON shape the operator (or
// the auto-fence path) stored: bare geometry, Feature, or FeatureCollection.
// Returns null when nothing polygonal is found — the fence is then skipped
// (and convex/geofences.ts:create rejects such geojson up front).
interface LooseGeoJson {
  type?: string;
  geometry?: LooseGeoJson | null;
  features?: LooseGeoJson[];
  coordinates?: unknown;
}

export function extractFencePolygon(raw: string): Polygon | MultiPolygon | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return findPolygon(parsed as LooseGeoJson);
}

function findPolygon(g: LooseGeoJson | null | undefined): Polygon | MultiPolygon | null {
  if (!g || typeof g !== 'object') return null;
  if ((g.type === 'Polygon' || g.type === 'MultiPolygon') && g.coordinates)
    return g as unknown as Polygon | MultiPolygon;
  if (g.type === 'Feature') return findPolygon(g.geometry);
  if (g.type === 'FeatureCollection' && Array.isArray(g.features)) {
    for (const f of g.features) {
      const p = findPolygon(f);
      if (p) return p;
    }
  }
  return null;
}

type Transition = 'enter' | 'exit' | 'dwell';

// Confidence per ARCHITECTURE §4: point-in-polygon is deterministic, so the
// candidate inherits the mover position quality (community instrument, 0.8).
// A stale-exit is inferred from absence, not an observed position: 0.6.
const POSITION_CONFIDENCE = 0.8;
const STALE_CONFIDENCE = 0.6;

function makeCandidate(
  fence: Doc<'geofences'>,
  transition: Transition,
  entityId: string,
  now: number,
  detail: { title: string; summary: string; rationale: string; lat?: number; lng?: number; confidence: number },
): DerivedCandidate {
  const day = new Date(now).toISOString().slice(0, 10);
  return {
    rule: 'geofence',
    title: detail.title,
    summary: detail.summary,
    severity: fence.severity,
    lat: detail.lat,
    lng: detail.lng,
    confidence: detail.confidence,
    contributingIds: [], // driven by entity positions, not signals
    rationale: detail.rationale,
    dedupeKey: `derived:geofence:${fence._id}:${entityId}:${transition}:${day}`,
    notify: true,
  };
}

export function evaluateGeofences(ctx: BrainContext): GeofenceResult {
  const derived: DerivedCandidate[] = [];
  const stateChanges: GeofenceStateChange[] = [];

  const stateByKey = new Map<string, Doc<'geofenceStates'>>();
  for (const s of ctx.fenceStates) stateByKey.set(`${s.fenceId}:${s.entityId}`, s);

  for (const fence of ctx.fences) {
    if (!fence.active) continue; // loadContext already filters; belt and suspenders
    const polygon = extractFencePolygon(fence.geojson);
    if (!polygon) continue; // unusable geometry: skip, never throw mid-tick
    const kinds = new Set(fence.entityKinds);
    const fenceId = String(fence._id);
    // entities evaluated against this fence on this tick (fresh + kind match)
    const seen = new Set<string>();

    for (const m of ctx.movers) {
      // empty entityKinds = fence applies to every mover kind
      if (kinds.size > 0 && !kinds.has(m.kind)) continue;
      const entityId = String(m._id);
      seen.add(entityId);

      const inside = booleanPointInPolygon([m.lng, m.lat], polygon);
      const prior = stateByKey.get(`${fenceId}:${entityId}`);
      const wasInside = prior?.lastInside ?? false;
      const at = `${m.lat.toFixed(3)}, ${m.lng.toFixed(3)}`;

      if (inside && !wasInside) {
        // ENTER transition
        const fires = fence.rule === 'enter';
        stateChanges.push({ fenceId, entityId, insideSince: ctx.now, lastInside: true, fireNow: fires });
        if (fires)
          derived.push(
            makeCandidate(fence, 'enter', entityId, ctx.now, {
              title: `${m.label} entered ${fence.name}`,
              summary: `${m.kind} ${m.label} crossed into geofence ${fence.name} at ${at}.`,
              rationale: `Fence ${fence.name} is set to fire on entry for ${
                kinds.size > 0 ? fence.entityKinds.join(', ') : 'all'
              } entities. ${m.label} was outside on the previous check and its latest position is inside the fence polygon.`,
              lat: m.lat,
              lng: m.lng,
              confidence: POSITION_CONFIDENCE,
            }),
          );
      } else if (!inside && wasInside) {
        // EXIT transition
        const fires = fence.rule === 'exit';
        stateChanges.push({ fenceId, entityId, insideSince: undefined, lastInside: false, fireNow: fires });
        if (fires)
          derived.push(
            makeCandidate(fence, 'exit', entityId, ctx.now, {
              title: `${m.label} left ${fence.name}`,
              summary: `${m.kind} ${m.label} moved out of geofence ${fence.name}, now at ${at}.`,
              rationale: `Fence ${fence.name} is set to fire on exit. ${m.label} was inside on the previous check and its latest position is outside the fence polygon.`,
              lat: m.lat,
              lng: m.lng,
              confidence: POSITION_CONFIDENCE,
            }),
          );
      } else if (inside && wasInside && fence.rule === 'dwell') {
        // DWELL: fires once per stay, when insideSince + dwellSec passes.
        const dwellMs = (fence.dwellSec ?? 0) * 1000;
        const since = prior?.insideSince;
        if (since === undefined || dwellMs <= 0) continue;
        if (ctx.now - since < dwellMs) continue;
        const alreadyFired = prior?.lastFiredAt !== undefined && prior.lastFiredAt >= since;
        if (alreadyFired) continue;
        const dwellMin = Math.round((ctx.now - since) / 60000);
        stateChanges.push({ fenceId, entityId, insideSince: since, lastInside: true, fireNow: true });
        derived.push(
          makeCandidate(fence, 'dwell', entityId, ctx.now, {
            title: `${m.label} loitering in ${fence.name}`,
            summary: `${m.kind} ${m.label} has stayed inside geofence ${fence.name} for ${dwellMin} min (threshold ${Math.round(
              dwellMs / 60000,
            )} min). Current position ${at}.`,
            rationale: `Fence ${fence.name} fires when an entity remains inside longer than ${
              fence.dwellSec
            } seconds. ${m.label} entered at ${new Date(since).toISOString()} and is still inside.`,
            lat: m.lat,
            lng: m.lng,
            confidence: POSITION_CONFIDENCE,
          }),
        );
      }
      // inside && wasInside with rule enter/exit, or outside && !wasInside:
      // steady state, no change written (keeps geofenceStates churn at zero).
    }

    // STALENESS AS EXIT: a previously-inside entity absent from the fresh
    // mover set (went dark, or no longer matches the fence's kinds) exits now.
    for (const s of ctx.fenceStates) {
      if (String(s.fenceId) !== fenceId) continue;
      if (!s.lastInside) continue;
      const entityId = String(s.entityId);
      if (seen.has(entityId)) continue;
      const fires = fence.rule === 'exit';
      stateChanges.push({ fenceId, entityId, insideSince: undefined, lastInside: false, fireNow: fires });
      if (fires)
        derived.push(
          makeCandidate(fence, 'exit', entityId, ctx.now, {
            title: `Contact lost inside ${fence.name}`,
            summary: `An entity that was inside geofence ${fence.name} stopped reporting and is treated as having exited.`,
            rationale: `Fence ${fence.name} is set to fire on exit. This entity was inside on the previous check but has not reported a position in over 10 minutes, so the fence treats it as an exit. It may have gone dark rather than physically left.`,
            confidence: STALE_CONFIDENCE,
          }),
        );
    }
  }

  return { derived, stateChanges };
}
