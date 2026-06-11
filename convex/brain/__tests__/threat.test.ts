import { describe, expect, it } from 'vitest';
import type { Doc } from '../../_generated/dataModel';
import type { BrainContext } from '../types';
import {
  computeThreat,
  recencyDecay,
  proximityWeight,
  DECAY_HALF_LIFE_MS,
  FACTOR_LIMIT,
} from '../threat';

// Synthetic fixtures over the pure computeThreat (ARCHITECTURE §7.7).
// One context per threat level plus the individual weighting behaviors.

const NOW = 1_750_000_000_000;
const VICTORIA = { lat: 48.4284, lng: -123.3656 };

let seq = 0;

function signal(over: Partial<Doc<'signals'>>): Doc<'signals'> {
  seq += 1;
  return {
    _id: `signal_${seq}`,
    _creationTime: NOW,
    sourceSlug: 'test',
    kind: 'earthquake',
    title: `Test signal ${seq}`,
    severity: 'info',
    observedAt: NOW,
    dedupeKey: `test:${seq}`,
    confidence: 1,
    provenance: '{}',
    ...over,
  } as unknown as Doc<'signals'>;
}

function alert(over: Partial<Doc<'alerts'>>): Doc<'alerts'> {
  seq += 1;
  return {
    _id: `alert_${seq}`,
    _creationTime: NOW,
    sourceSlug: 'test',
    capId: `cap:${seq}`,
    headline: `Test alert ${seq}`,
    severity: 'warning',
    effective: NOW,
    status: 'active',
    ...over,
  } as unknown as Doc<'alerts'>;
}

function ctxWith(over: Partial<BrainContext>): BrainContext {
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

describe('computeThreat levels', () => {
  it('returns NOMINAL with zero score on an empty context', () => {
    const result = computeThreat(ctxWith({}));
    expect(result.level).toBe('NOMINAL');
    expect(result.score).toBe(0);
    expect(result.factors).toEqual([]);
  });

  it('stays NOMINAL on light activity (one fresh watch near Victoria)', () => {
    const result = computeThreat(
      ctxWith({ signals: [signal({ severity: 'watch', ...VICTORIA })] }),
    );
    // 2 (watch) x 1.0 (fresh) x 1.0 (near) = 2 < 8
    expect(result.score).toBeCloseTo(2, 5);
    expect(result.level).toBe('NOMINAL');
  });

  it('reads ELEVATED on two fresh warnings near Victoria', () => {
    const result = computeThreat(
      ctxWith({
        signals: [
          signal({ severity: 'warning', ...VICTORIA }),
          signal({ severity: 'warning', ...VICTORIA }),
        ],
      }),
    );
    // 2 x 5 x 1.0 x 1.0 = 10, between 8 and 25
    expect(result.score).toBeCloseTo(10, 5);
    expect(result.level).toBe('ELEVATED');
  });

  it('reads HIGH on three fresh criticals near Victoria', () => {
    const result = computeThreat(
      ctxWith({
        signals: [
          signal({ severity: 'critical', ...VICTORIA }),
          signal({ severity: 'critical', ...VICTORIA }),
          signal({ severity: 'critical', ...VICTORIA }),
        ],
      }),
    );
    // 3 x 12 x 1.0 x 1.0 = 36 >= 25
    expect(result.score).toBeCloseTo(36, 5);
    expect(result.level).toBe('HIGH');
  });
});

describe('weighting behaviors', () => {
  it('halves a contribution at one half-life of age', () => {
    const result = computeThreat(
      ctxWith({
        signals: [
          signal({ severity: 'critical', ...VICTORIA, observedAt: NOW - DECAY_HALF_LIFE_MS }),
        ],
      }),
    );
    // 12 x 0.5 x 1.0 = 6
    expect(result.score).toBeCloseTo(6, 2);
  });

  it('does not boost future-dated observations past full weight', () => {
    expect(recencyDecay(NOW, NOW + 3600_000)).toBe(1);
  });

  it('applies the three proximity tiers', () => {
    expect(proximityWeight(VICTORIA.lat, VICTORIA.lng)).toBe(1.0); // near
    expect(proximityWeight(48.8, -123.3656)).toBe(0.5); // ~41 km from Victoria
    expect(proximityWeight(54.0, -130.0)).toBe(0.25); // far north of the Island
    expect(proximityWeight(undefined, undefined)).toBe(0.25); // no geometry
  });

  it('excludes world-event signals entirely', () => {
    const result = computeThreat(
      ctxWith({
        signals: [
          signal({ kind: 'world-event', severity: 'critical', ...VICTORIA }),
          signal({ kind: 'world-event', severity: 'critical' }),
        ],
      }),
    );
    expect(result.score).toBe(0);
    expect(result.level).toBe('NOMINAL');
    expect(result.factors).toEqual([]);
  });

  it('counts active alerts and locates them by their area geometry', () => {
    const ring = [
      [-123.4, 48.4],
      [-123.3, 48.4],
      [-123.3, 48.5],
      [-123.4, 48.5],
      [-123.4, 48.4],
    ];
    const result = computeThreat(
      ctxWith({
        alerts: [
          alert({
            severity: 'critical',
            area: JSON.stringify({ type: 'Polygon', coordinates: [ring] }),
          }),
        ],
      }),
    );
    // vertex average sits on top of Victoria: 12 x 1.0 x 1.0 = 12
    expect(result.score).toBeCloseTo(12, 2);
    expect(result.level).toBe('ELEVATED');
    expect(result.factors[0].label).toContain('Alert:');
  });

  it('treats an alert without area as no-geo and skips expired alerts', () => {
    const result = computeThreat(
      ctxWith({
        alerts: [
          alert({ severity: 'critical' }), // no area: 12 x 1.0 x 0.25 = 3
          alert({ severity: 'critical', expires: NOW - 1 }), // expired: 0
        ],
      }),
    );
    expect(result.score).toBeCloseTo(3, 2);
    expect(result.factors).toHaveLength(1);
  });
});

describe('factors', () => {
  it('caps factors at the limit, sorted by weight descending, with signal ids', () => {
    const signals = [
      ...Array.from({ length: 6 }, () => signal({ severity: 'info', ...VICTORIA })),
      ...Array.from({ length: 4 }, () => signal({ severity: 'critical', ...VICTORIA })),
    ];
    const result = computeThreat(ctxWith({ signals }));
    expect(result.factors).toHaveLength(FACTOR_LIMIT);
    for (let i = 1; i < result.factors.length; i++) {
      expect(result.factors[i - 1].weight).toBeGreaterThanOrEqual(result.factors[i].weight);
    }
    // the four criticals lead the list
    expect(result.factors[0].weight).toBeCloseTo(12, 2);
    expect(result.factors[3].weight).toBeCloseTo(12, 2);
    expect(result.factors[0].signalId).toBeTruthy();
    // score still counts everything, not just the top 8: 4x12 + 6x0.5 = 51
    expect(result.score).toBeCloseTo(51, 2);
    expect(result.level).toBe('HIGH');
  });
});
