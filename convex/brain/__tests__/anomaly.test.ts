import { describe, expect, it } from 'vitest';
import type { Doc } from '../../_generated/dataModel';
import type { BrainContext } from '../types';
import { evaluateAnomalies } from '../anomaly';
import { computeStats } from '../baselines';

// Synthetic-fixture tests (Phase 6 gate): spikes fire, normal stays silent.
// evaluateAnomalies is pure, so fixtures are plain objects cast to Docs.

const NOW = Date.UTC(2026, 5, 11, 18, 0, 0);

function mkBaseline(metric: string, over: Partial<Doc<'baselines'>> = {}): Doc<'baselines'> {
  return {
    _id: `bl_${metric}`,
    _creationTime: NOW,
    metric,
    windowHours: 168,
    mean: 10,
    stddev: 2,
    p95: 13,
    n: 100,
    updatedAt: NOW,
    ...over,
  } as unknown as Doc<'baselines'>;
}

function mkMover(kind: string, i: number): Doc<'entities'> {
  return {
    _id: `ent_${kind}_${i}`,
    _creationTime: NOW,
    kind,
    extId: `${kind}-${i}`,
    label: `${kind} ${i}`,
    sourceSlug: 'test',
    lat: 48.5,
    lng: -123.4,
    firstSeenAt: NOW - 3600_000,
    lastSeenAt: NOW,
    stale: false,
    watch: false,
  } as unknown as Doc<'entities'>;
}

function mkReading(
  stationId: string,
  metric: string,
  value: number,
  at: number,
): Doc<'readings'> {
  return {
    _id: `rd_${stationId}_${at}`,
    _creationTime: at,
    stationId,
    metric,
    value,
    unit: 'index',
    at,
    lat: 48.43,
    lng: -123.36,
    sourceSlug: 'eccc-aqhi',
  } as unknown as Doc<'readings'>;
}

function mkQuake(i: number, observedAt: number): Doc<'signals'> {
  return {
    _id: `sig_quake_${i}`,
    _creationTime: observedAt,
    sourceSlug: 'usgs-quakes',
    kind: 'earthquake',
    title: `M2.${i} earthquake`,
    severity: 'info',
    lat: 48.3 + i * 0.01,
    lng: -123.5,
    observedAt,
    dedupeKey: `usgs-quakes:test-${i}`,
    confidence: 1,
    provenance: '{}',
  } as unknown as Doc<'signals'>;
}

function mkCtx(over: Partial<BrainContext> = {}): BrainContext {
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

describe('mover count anomalies', () => {
  it('fires a watch when the aircraft count is more than 3 sigma above baseline', () => {
    // baseline 10 +/- 2; 30 aircraft is z = 10
    const ctx = mkCtx({ movers: Array.from({ length: 30 }, (_, i) => mkMover('aircraft', i)) });
    const out = evaluateAnomalies(ctx, [mkBaseline('count:aircraft')]);
    expect(out).toHaveLength(1);
    expect(out[0].severity).toBe('watch');
    expect(out[0].rule).toBe('anomaly-count');
    expect(out[0].title).toBe('Unusual aircraft activity');
    expect(out[0].summary).toContain('30 vs typical 10');
    expect(out[0].confidence).toBe(0.6);
    expect(out[0].dedupeKey).toBe('derived:anomaly-count:aircraft:2026-06-11');
    expect(out[0].rationale).toContain('30');
    expect(out[0].rationale).toContain('standard deviations');
  });

  it('stays silent when the count is within normal range', () => {
    // baseline 10 +/- 2; 12 aircraft is z = 1
    const ctx = mkCtx({ movers: Array.from({ length: 12 }, (_, i) => mkMover('aircraft', i)) });
    expect(evaluateAnomalies(ctx, [mkBaseline('count:aircraft')])).toHaveLength(0);
  });

  it('stays silent when no baseline exists for the kind', () => {
    const ctx = mkCtx({ movers: Array.from({ length: 50 }, (_, i) => mkMover('vessel', i)) });
    expect(evaluateAnomalies(ctx, [])).toHaveLength(0);
  });

  it('ignores baselines with too few samples or zero spread', () => {
    const ctx = mkCtx({ movers: Array.from({ length: 50 }, (_, i) => mkMover('bus', i)) });
    expect(evaluateAnomalies(ctx, [mkBaseline('count:bus', { n: 5 })])).toHaveLength(0);
    expect(evaluateAnomalies(ctx, [mkBaseline('count:bus', { stddev: 0 })])).toHaveLength(0);
  });

  it('does not fire on drops below baseline', () => {
    // baseline 10 +/- 2 and zero movers: z = -5, spikes only
    const ctx = mkCtx({ movers: [] });
    expect(evaluateAnomalies(ctx, [mkBaseline('count:aircraft')])).toHaveLength(0);
  });
});

describe('aqhi anomalies', () => {
  const STATION = 'eccc-aqhi:victoria';
  const aqhiBaseline = mkBaseline(`aqhi:${STATION}`, { mean: 3, stddev: 1, p95: 5, n: 50 });

  it('fires a watch on an AQHI spike at a station with a baseline', () => {
    const ctx = mkCtx({ readings: [mkReading(STATION, 'aqhi', 9, NOW - 60_000)] });
    const out = evaluateAnomalies(ctx, [aqhiBaseline]);
    expect(out).toHaveLength(1);
    expect(out[0].rule).toBe('anomaly-aqhi');
    expect(out[0].severity).toBe('watch');
    expect(out[0].title).toBe('AQHI spike at victoria');
    expect(out[0].lat).toBeCloseTo(48.43);
    expect(out[0].dedupeKey).toBe(`derived:anomaly-aqhi:${STATION}:2026-06-11`);
  });

  it('uses only the latest reading per station', () => {
    // older reading spiked, latest is back to normal: silent
    const ctx = mkCtx({
      readings: [
        mkReading(STATION, 'aqhi', 3, NOW - 60_000),
        mkReading(STATION, 'aqhi', 9, NOW - 30 * 60_000),
      ],
    });
    expect(evaluateAnomalies(ctx, [aqhiBaseline])).toHaveLength(0);
  });

  it('stays silent on normal readings and ignores other metrics', () => {
    const ctx = mkCtx({
      readings: [
        mkReading(STATION, 'aqhi', 4, NOW - 60_000),
        mkReading('dfo-tides:07120', 'water_level', 99, NOW - 60_000),
      ],
    });
    expect(evaluateAnomalies(ctx, [aqhiBaseline])).toHaveLength(0);
  });
});

describe('quake rate anomalies', () => {
  const rateBaseline = mkBaseline('rate:quakes', { mean: 2, stddev: 1, p95: 4, n: 28 });

  it('fires a seismic swarm watch when the 6h quake count spikes', () => {
    const quakes = Array.from({ length: 12 }, (_, i) => mkQuake(i, NOW - i * 10 * 60_000));
    const out = evaluateAnomalies(mkCtx({ signals: quakes }), [rateBaseline]);
    expect(out).toHaveLength(1);
    expect(out[0].rule).toBe('anomaly-quakes');
    expect(out[0].title).toBe('Possible seismic swarm');
    expect(out[0].severity).toBe('watch');
    expect(out[0].summary).toContain('12 earthquakes');
    expect(out[0].contributingIds).toHaveLength(12);
    expect(out[0].lat).toBeDefined();
  });

  it('excludes quakes older than 6 hours from the count', () => {
    const old = Array.from({ length: 12 }, (_, i) => mkQuake(i, NOW - 7 * 3600_000));
    const recent = [mkQuake(99, NOW - 60_000)];
    expect(evaluateAnomalies(mkCtx({ signals: [...old, ...recent] }), [rateBaseline])).toHaveLength(
      0,
    );
  });

  it('stays silent when no rate:quakes baseline exists', () => {
    const quakes = Array.from({ length: 30 }, (_, i) => mkQuake(i, NOW - i * 60_000));
    expect(evaluateAnomalies(mkCtx({ signals: quakes }), [])).toHaveLength(0);
  });
});

describe('rule config gating', () => {
  it('goes fully silent when the anomaly rule row is disabled', () => {
    const ctx = mkCtx({
      movers: Array.from({ length: 50 }, (_, i) => mkMover('aircraft', i)),
      ruleParams: { anomaly: { params: '{}', severity: 'watch', active: false } },
    });
    expect(evaluateAnomalies(ctx, [mkBaseline('count:aircraft')])).toHaveLength(0);
  });

  it('respects a zThreshold override from rule params', () => {
    // 14 aircraft on a 10 +/- 2 baseline is z = 2: silent at 3, fires at 1.5
    const ctx = mkCtx({
      movers: Array.from({ length: 14 }, (_, i) => mkMover('aircraft', i)),
      ruleParams: { anomaly: { params: '{"zThreshold":1.5}', severity: 'watch', active: true } },
    });
    expect(evaluateAnomalies(ctx, [mkBaseline('count:aircraft')])).toHaveLength(1);
  });
});

describe('baseline stats', () => {
  it('computes mean, stddev, and p95', () => {
    const values = [2, 4, 4, 4, 5, 5, 7, 9];
    const s = computeStats(values);
    expect(s.mean).toBe(5);
    expect(s.stddev).toBe(2); // classic population-stddev example
    expect(s.p95).toBe(9);
  });

  it('handles a constant series with zero stddev', () => {
    const s = computeStats(Array.from({ length: 30 }, () => 7));
    expect(s.mean).toBe(7);
    expect(s.stddev).toBe(0);
    expect(s.p95).toBe(7);
  });
});
