import { describe, expect, it } from 'vitest';
import { evaluateGeofences, extractFencePolygon } from '../geofence';
import type { BrainContext } from '../types';

// Synthetic fixtures over the pure evaluator (ARCHITECTURE §7.2 / Phase 6
// gate). Square fence over the Victoria approaches; one vessel mover.

const NOW = Date.UTC(2026, 5, 11, 18, 0, 0); // 2026-06-11T18:00:00Z
const DAY = '2026-06-11';

const SQUARE = JSON.stringify({
  type: 'Feature',
  properties: {},
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [-123.5, 48.3],
        [-123.2, 48.3],
        [-123.2, 48.5],
        [-123.5, 48.5],
        [-123.5, 48.3],
      ],
    ],
  },
});

type Fence = BrainContext['fences'][number];
type Mover = BrainContext['movers'][number];
type FenceState = BrainContext['fenceStates'][number];

function fence(over: Partial<Record<string, unknown>> = {}): Fence {
  return {
    _id: 'fence1',
    _creationTime: 0,
    name: 'Victoria approach',
    geojson: SQUARE,
    rule: 'enter',
    entityKinds: ['vessel'],
    severity: 'watch',
    active: true,
    ...over,
  } as unknown as Fence;
}

function mover(over: Partial<Record<string, unknown>> = {}): Mover {
  return {
    _id: 'ent1',
    _creationTime: 0,
    kind: 'vessel',
    extId: '316001245',
    label: 'COASTAL RANGER',
    sourceSlug: 'aisstream',
    lat: 48.4, // inside the square
    lng: -123.35,
    firstSeenAt: NOW - 3600_000,
    lastSeenAt: NOW,
    stale: false,
    watch: false,
    ...over,
  } as unknown as Mover;
}

function fenceState(over: Partial<Record<string, unknown>> = {}): FenceState {
  return {
    _id: 'state1',
    _creationTime: 0,
    fenceId: 'fence1',
    entityId: 'ent1',
    lastInside: true,
    ...over,
  } as unknown as FenceState;
}

function ctx(over: Partial<BrainContext> = {}): BrainContext {
  return {
    now: NOW,
    signals: [],
    alerts: [],
    movers: [],
    readings: [],
    fences: [],
    fenceStates: [],
    watchlist: [],
    ruleParams: {},
    sources: [],
    ...over,
  };
}

describe('extractFencePolygon', () => {
  it('accepts Feature, FeatureCollection, and bare geometry; rejects junk', () => {
    expect(extractFencePolygon(SQUARE)).not.toBeNull();
    const geom = JSON.parse(SQUARE).geometry;
    expect(extractFencePolygon(JSON.stringify(geom))).not.toBeNull();
    expect(
      extractFencePolygon(JSON.stringify({ type: 'FeatureCollection', features: [JSON.parse(SQUARE)] })),
    ).not.toBeNull();
    expect(extractFencePolygon('not json')).toBeNull();
    expect(
      extractFencePolygon(JSON.stringify({ type: 'Point', coordinates: [-123.3, 48.4] })),
    ).toBeNull();
  });
});

describe('enter transitions', () => {
  it('fires once on entry, then stays quiet while the entity remains inside', () => {
    // tick 1: vessel inside, no prior state -> enter fires
    const first = evaluateGeofences(ctx({ fences: [fence()], movers: [mover()] }));
    expect(first.derived).toHaveLength(1);
    expect(first.derived[0].dedupeKey).toBe(`derived:geofence:fence1:ent1:enter:${DAY}`);
    expect(first.derived[0].severity).toBe('watch');
    expect(first.derived[0].notify).toBe(true);
    expect(first.stateChanges).toEqual([
      { fenceId: 'fence1', entityId: 'ent1', insideSince: NOW, lastInside: true, fireNow: true },
    ]);

    // tick 2: same vessel still inside, state committed -> nothing new
    const second = evaluateGeofences(
      ctx({
        fences: [fence()],
        movers: [mover()],
        fenceStates: [fenceState({ insideSince: NOW, lastFiredAt: NOW })],
      }),
    );
    expect(second.derived).toHaveLength(0);
    expect(second.stateChanges).toHaveLength(0);
  });

  it('tracks state but does not fire enter on a dwell fence, and skips non-matching kinds', () => {
    const result = evaluateGeofences(
      ctx({
        fences: [fence({ rule: 'dwell', dwellSec: 600 })],
        movers: [mover(), mover({ _id: 'ent2', kind: 'aircraft', label: 'CGTQM' })],
      }),
    );
    // aircraft filtered out by entityKinds; vessel enters silently
    expect(result.derived).toHaveLength(0);
    expect(result.stateChanges).toEqual([
      { fenceId: 'fence1', entityId: 'ent1', insideSince: NOW, lastInside: true, fireNow: false },
    ]);
  });
});

describe('dwell transitions', () => {
  const dwellFence = () => fence({ rule: 'dwell', dwellSec: 600 });

  it('fires after the dwell threshold passes', () => {
    const since = NOW - 700_000; // inside for ~11.7 min, threshold 10 min
    const result = evaluateGeofences(
      ctx({ fences: [dwellFence()], movers: [mover()], fenceStates: [fenceState({ insideSince: since })] }),
    );
    expect(result.derived).toHaveLength(1);
    expect(result.derived[0].dedupeKey).toBe(`derived:geofence:fence1:ent1:dwell:${DAY}`);
    expect(result.stateChanges).toEqual([
      { fenceId: 'fence1', entityId: 'ent1', insideSince: since, lastInside: true, fireNow: true },
    ]);
  });

  it('stays quiet before the threshold', () => {
    const result = evaluateGeofences(
      ctx({
        fences: [dwellFence()],
        movers: [mover()],
        fenceStates: [fenceState({ insideSince: NOW - 100_000 })],
      }),
    );
    expect(result.derived).toHaveLength(0);
    expect(result.stateChanges).toHaveLength(0);
  });

  it('does not re-fire once lastFiredAt covers the current stay', () => {
    const since = NOW - 900_000;
    const result = evaluateGeofences(
      ctx({
        fences: [dwellFence()],
        movers: [mover()],
        fenceStates: [fenceState({ insideSince: since, lastFiredAt: NOW - 120_000 })],
      }),
    );
    expect(result.derived).toHaveLength(0);
    expect(result.stateChanges).toHaveLength(0);
  });
});

describe('exit transitions', () => {
  it('fires exit and clears insideSince when the entity moves out', () => {
    const result = evaluateGeofences(
      ctx({
        fences: [fence({ rule: 'exit' })],
        movers: [mover({ lat: 47.9, lng: -123.35 })], // south of the square
        fenceStates: [fenceState({ insideSince: NOW - 600_000 })],
      }),
    );
    expect(result.derived).toHaveLength(1);
    expect(result.derived[0].dedupeKey).toBe(`derived:geofence:fence1:ent1:exit:${DAY}`);
    expect(result.stateChanges).toEqual([
      { fenceId: 'fence1', entityId: 'ent1', insideSince: undefined, lastInside: false, fireNow: true },
    ]);
  });

  it('clears state silently on exit when the fence rule is enter', () => {
    const result = evaluateGeofences(
      ctx({
        fences: [fence({ rule: 'enter' })],
        movers: [mover({ lat: 47.9 })],
        fenceStates: [fenceState({ insideSince: NOW - 600_000 })],
      }),
    );
    expect(result.derived).toHaveLength(0);
    expect(result.stateChanges).toEqual([
      { fenceId: 'fence1', entityId: 'ent1', insideSince: undefined, lastInside: false, fireNow: false },
    ]);
  });

  it('treats a stale previously-inside entity as an exit', () => {
    // vessel went dark: state says inside but it is absent from fresh movers
    const result = evaluateGeofences(
      ctx({
        fences: [fence({ rule: 'exit' })],
        movers: [],
        fenceStates: [fenceState({ insideSince: NOW - 1200_000 })],
      }),
    );
    expect(result.derived).toHaveLength(1);
    expect(result.derived[0].dedupeKey).toBe(`derived:geofence:fence1:ent1:exit:${DAY}`);
    expect(result.derived[0].confidence).toBeLessThan(0.8); // inferred from absence
    expect(result.stateChanges).toEqual([
      { fenceId: 'fence1', entityId: 'ent1', insideSince: undefined, lastInside: false, fireNow: true },
    ]);
  });

  it('stale-inside clears state without firing when the fence rule is enter', () => {
    const result = evaluateGeofences(
      ctx({
        fences: [fence({ rule: 'enter' })],
        movers: [],
        fenceStates: [fenceState({ insideSince: NOW - 1200_000 })],
      }),
    );
    expect(result.derived).toHaveLength(0);
    expect(result.stateChanges).toEqual([
      { fenceId: 'fence1', entityId: 'ent1', insideSince: undefined, lastInside: false, fireNow: false },
    ]);
  });
});

describe('steady states and edge cases', () => {
  it('produces nothing for an outside entity with no prior state', () => {
    const result = evaluateGeofences(ctx({ fences: [fence()], movers: [mover({ lat: 47.9 })] }));
    expect(result.derived).toHaveLength(0);
    expect(result.stateChanges).toHaveLength(0);
  });

  it('skips fences with unusable geometry instead of throwing', () => {
    const result = evaluateGeofences(
      ctx({ fences: [fence({ geojson: '{"type":"Point","coordinates":[0,0]}' })], movers: [mover()] }),
    );
    expect(result.derived).toHaveLength(0);
    expect(result.stateChanges).toHaveLength(0);
  });

  it('matches all kinds when entityKinds is empty', () => {
    const result = evaluateGeofences(
      ctx({ fences: [fence({ entityKinds: [] })], movers: [mover({ kind: 'aircraft' })] }),
    );
    expect(result.derived).toHaveLength(1);
  });
});
