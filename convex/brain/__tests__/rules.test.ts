import { describe, expect, it } from 'vitest';
import type { Doc, Id } from '../../_generated/dataModel';
import type { BrainContext } from '../types';
import { tsunamiCorrelation } from '../rules/tsunamiCorrelation';
import { smokeEta } from '../rules/smokeEta';
import { sanctionsMatch } from '../rules/sanctionsMatch';
import { aisGapSensitive } from '../rules/aisGapSensitive';

// Synthetic-fixture tests for the seed fusion rules (Phase 6 acceptance gate:
// each rule fires on crafted input and stays silent on clean input). Rules
// are pure functions over BrainContext, so fixtures are plain objects.

const NOW = Date.UTC(2026, 5, 11, 12, 0, 0); // fixed tick time
const MIN = 60_000;

let seq = 0;
function nextId<T extends string>(table: T): Id<T & ('signals' | 'entities')> {
  return `${table}_${++seq}` as Id<T & ('signals' | 'entities')>;
}

export function makeContext(overrides: Partial<BrainContext> = {}): BrainContext {
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
    ...overrides,
  };
}

// ---- fixture builders (cast through unknown: _id/_creationTime are branded) ----

function quakeSignal(opts: {
  mag: number;
  depthKm: number;
  lat: number;
  lng: number;
  agoMin?: number;
  confidence?: number;
}): Doc<'signals'> {
  const observedAt = NOW - (opts.agoMin ?? 15) * MIN;
  return {
    _id: nextId('signals'),
    _creationTime: observedAt,
    sourceSlug: 'usgs-quakes',
    kind: 'earthquake',
    title: `M${opts.mag.toFixed(1)} test quake`,
    severity: 'warning',
    lat: opts.lat,
    lng: opts.lng,
    observedAt,
    dedupeKey: `usgs-quakes:test-${seq}`,
    confidence: opts.confidence ?? 1.0,
    provenance: JSON.stringify({ method: 'poll', fetchedAt: observedAt }),
    raw: JSON.stringify({ mag: opts.mag, depthKm: opts.depthKm }),
  } as unknown as Doc<'signals'>;
}

function fireSignal(opts: { lat: number; lng: number; status?: string }): Doc<'signals'> {
  return {
    _id: nextId('signals'),
    _creationTime: NOW - 30 * MIN,
    sourceSlug: 'bcws-fires',
    kind: 'wildfire',
    title: `Fire V${seq} test ridge`,
    severity: 'warning',
    lat: opts.lat,
    lng: opts.lng,
    observedAt: NOW - 30 * MIN,
    dedupeKey: `bcws-fires:2026-V${seq}`,
    confidence: 1.0,
    provenance: JSON.stringify({ method: 'poll', fetchedAt: NOW }),
    raw: JSON.stringify({ hectares: 120, status: opts.status ?? 'Out of Control' }),
  } as unknown as Doc<'signals'>;
}

function reading(opts: {
  stationId: string;
  metric: string;
  value: number;
  unit: string;
  agoMin: number;
  lat?: number;
  lng?: number;
}): Doc<'readings'> {
  return {
    _id: nextId('readings'),
    _creationTime: NOW - opts.agoMin * MIN,
    stationId: opts.stationId,
    metric: opts.metric,
    value: opts.value,
    unit: opts.unit,
    at: NOW - opts.agoMin * MIN,
    lat: opts.lat,
    lng: opts.lng,
    sourceSlug: opts.stationId.split(':')[0],
  } as unknown as Doc<'readings'>;
}

function vessel(opts: { mmsi: string; label?: string; lat?: number; lng?: number }): Doc<'entities'> {
  return {
    _id: nextId('entities'),
    _creationTime: NOW - 5 * MIN,
    kind: 'vessel',
    extId: opts.mmsi,
    label: opts.label ?? `MV TEST ${opts.mmsi}`,
    sourceSlug: 'aisstream',
    lat: opts.lat ?? 48.6,
    lng: opts.lng ?? -123.4,
    firstSeenAt: NOW - 60 * MIN,
    lastSeenAt: NOW - 2 * MIN,
    stale: false,
    watch: false,
  } as unknown as Doc<'entities'>;
}

function watchEntry(opts: { mmsi: string; label?: string; active?: boolean; kind?: string }): Doc<'watchlist'> {
  return {
    _id: nextId('watchlist'),
    _creationTime: NOW - 24 * 60 * MIN,
    kind: opts.kind ?? 'vessel',
    identifier: opts.mmsi,
    label: opts.label ?? `WATCHED ${opts.mmsi}`,
    active: opts.active ?? true,
  } as unknown as Doc<'watchlist'>;
}

function source(slug: string, status: 'live' | 'stale' | 'down' | 'disabled'): Doc<'sources'> {
  return {
    _id: nextId('sources'),
    _creationTime: NOW - 24 * 60 * MIN,
    slug,
    name: slug,
    cluster: 'seas',
    status,
    cadenceSec: 30,
    consecutiveFailures: 0,
    attribution: 'test',
  } as unknown as Doc<'sources'>;
}

// Tide gauge pair: latest reading + a reference 45 min earlier.
function gaugePair(stationId: string, earlier: number, latest: number): Doc<'readings'>[] {
  return [
    reading({ stationId, metric: 'water_level', value: latest, unit: 'm', agoMin: 5 }),
    reading({ stationId, metric: 'water_level', value: earlier, unit: 'm', agoMin: 50 }),
  ];
}

// ---- tsunami-correlation ----

describe('tsunami-correlation', () => {
  it('fires critical on offshore quake + tide gauge anomaly', () => {
    const quake = quakeSignal({ mag: 6.5, depthKm: 10, lat: 48.9, lng: -126.2 });
    const ctx = makeContext({
      signals: [quake],
      readings: gaugePair('dfo-tides:07120', 2.2, 2.9), // 0.7 m > 0.5 m default
    });
    const out = tsunamiCorrelation(ctx, {});
    expect(out).toHaveLength(1);
    expect(out[0].severity).toBe('critical');
    expect(out[0].notify).toBe(true);
    expect(out[0].contributingIds).toEqual([String(quake._id)]);
    expect(out[0].dedupeKey).toBe(`derived:tsunami-correlation:${String(quake._id)}`);
    expect(out[0].confidence).toBeCloseTo(0.85, 2);
  });

  it('raises confidence when a seafloor pressure spike corroborates', () => {
    const quake = quakeSignal({ mag: 6.5, depthKm: 10, lat: 48.9, lng: -126.2 });
    const ctx = makeContext({
      signals: [quake],
      readings: [
        ...gaugePair('dfo-tides:07120', 2.2, 2.9),
        reading({ stationId: 'onc-oceans:NEPTUNE', metric: 'seafloor_pressure', value: 1250.9, unit: 'dbar', agoMin: 5 }),
        reading({ stationId: 'onc-oceans:NEPTUNE', metric: 'seafloor_pressure', value: 1250.2, unit: 'dbar', agoMin: 50 }),
      ],
    });
    const out = tsunamiCorrelation(ctx, {});
    expect(out).toHaveLength(1);
    expect(out[0].confidence).toBeCloseTo(0.95, 2);
    expect(out[0].rationale).toContain('pressure');
  });

  it('emits a watch-level tsunami evaluation on a major quake alone (mag >= 7)', () => {
    const quake = quakeSignal({ mag: 7.2, depthKm: 12, lat: 48.7, lng: -127.0 });
    const ctx = makeContext({ signals: [quake] }); // gauges quiet
    const out = tsunamiCorrelation(ctx, {});
    expect(out).toHaveLength(1);
    expect(out[0].severity).toBe('watch');
    expect(out[0].title).toContain('Tsunami evaluation');
    expect(out[0].dedupeKey).toBe(`derived:tsunami-correlation:eval:${String(quake._id)}`);
  });

  it('stays silent on a moderate quake without gauge anomaly', () => {
    const quake = quakeSignal({ mag: 6.3, depthKm: 15, lat: 48.9, lng: -126.2 });
    const ctx = makeContext({
      signals: [quake],
      readings: gaugePair('dfo-tides:07120', 2.5, 2.6), // 0.1 m, below threshold
    });
    expect(tsunamiCorrelation(ctx, {})).toHaveLength(0);
  });

  it('stays silent below magThreshold even with a gauge anomaly', () => {
    const quake = quakeSignal({ mag: 5.8, depthKm: 10, lat: 48.9, lng: -126.2 });
    const ctx = makeContext({
      signals: [quake],
      readings: gaugePair('dfo-tides:07120', 2.2, 2.9),
    });
    expect(tsunamiCorrelation(ctx, {})).toHaveLength(0);
  });

  it('ignores deep onshore quakes (not offshore, not shallow)', () => {
    const quake = quakeSignal({ mag: 6.8, depthKm: 60, lat: 49.0, lng: -124.0 });
    const ctx = makeContext({
      signals: [quake],
      readings: gaugePair('dfo-tides:07120', 2.2, 2.9),
    });
    expect(tsunamiCorrelation(ctx, {})).toHaveLength(0);
  });

  it('respects param overrides (magThreshold)', () => {
    const quake = quakeSignal({ mag: 6.5, depthKm: 10, lat: 48.9, lng: -126.2 });
    const ctx = makeContext({
      signals: [quake],
      readings: gaugePair('dfo-tides:07120', 2.2, 2.9),
    });
    expect(tsunamiCorrelation(ctx, { magThreshold: 7 })).toHaveLength(0);
  });

  it('stays silent on a fully clean context', () => {
    expect(tsunamiCorrelation(makeContext(), {})).toHaveLength(0);
  });
});

// ---- smoke-eta ----

// Fire 48.70,-123.80 sits ~44 km NW of Victoria (48.43,-123.37); bearing
// fire→Victoria ≈ 134 deg. Wind FROM 315 deg blows the plume toward 135 deg.
function smokeFixture(windDirDeg: number, opts: { status?: string; stationFarAway?: boolean } = {}) {
  const fire = fireSignal({ lat: 48.7, lng: -123.8, status: opts.status });
  const stn = opts.stationFarAway
    ? { lat: 50.5, lng: -126.5 } // ~250 km away, outside windSearchKm
    : { lat: 48.72, lng: -123.82 };
  return {
    fire,
    ctx: makeContext({
      signals: [fire],
      readings: [
        reading({ stationId: 'uvic-mesh:deepcove', metric: 'wind_speed', value: 20, unit: 'km/h', agoMin: 10, ...stn }),
        reading({ stationId: 'uvic-mesh:deepcove', metric: 'wind_dir', value: windDirDeg, unit: '°', agoMin: 10, ...stn }),
      ],
    }),
  };
}

describe('smoke-eta', () => {
  it('projects smoke arrival at a downwind population center', () => {
    const { fire, ctx } = smokeFixture(315);
    const out = smokeEta(ctx, {});
    expect(out).toHaveLength(1);
    expect(out[0].severity).toBe('watch');
    expect(out[0].confidence).toBe(0.5);
    expect(out[0].title).toContain('Smoke may reach Victoria');
    expect(out[0].contributingIds).toEqual([String(fire._id)]);
    expect(out[0].dedupeKey).toBe(`derived:smoke-eta:${String(fire._id)}:victoria`);
    expect(out[0].rationale.toLowerCase()).toContain('projection');
    // ~44 km at 20 km/h ≈ 2.2 h
    expect(out[0].summary).toMatch(/2\.[0-4] h/);
  });

  it('stays silent when the wind blows away from every center', () => {
    const { ctx } = smokeFixture(135); // plume heads NW, open water
    expect(smokeEta(ctx, {})).toHaveLength(0);
  });

  it('stays silent when no wind station is near the fire', () => {
    const { ctx } = smokeFixture(315, { stationFarAway: true });
    expect(smokeEta(ctx, {})).toHaveLength(0);
  });

  it('skips fires reported as out', () => {
    const { ctx } = smokeFixture(315, { status: 'Out' });
    expect(smokeEta(ctx, {})).toHaveLength(0);
  });

  it('converts knot wind speeds via the reading unit', () => {
    const fire = fireSignal({ lat: 48.7, lng: -123.8 });
    const ctx = makeContext({
      signals: [fire],
      readings: [
        reading({ stationId: 'open-meteo:vic', metric: 'wind_speed', value: 10.8, unit: 'kt', agoMin: 10, lat: 48.72, lng: -123.82 }),
        reading({ stationId: 'open-meteo:vic', metric: 'wind_dir', value: 315, unit: 'deg', agoMin: 10, lat: 48.72, lng: -123.82 }),
      ],
    });
    const out = smokeEta(ctx, {});
    expect(out).toHaveLength(1);
    // 10.8 kt ≈ 20 km/h → same ~2.2 h ETA as the km/h fixture
    expect(out[0].summary).toMatch(/2\.[0-4] h/);
  });

  it('stays silent on a fully clean context', () => {
    expect(smokeEta(makeContext(), {})).toHaveLength(0);
  });
});

// ---- sanctions-match ----

describe('sanctions-match', () => {
  it('flags a vessel whose MMSI is on the configured list', () => {
    const ctx = makeContext({
      movers: [vessel({ mmsi: '316001234', label: 'MV SUSPECT' }), vessel({ mmsi: '316005678' })],
    });
    const out = sanctionsMatch(ctx, { sanctionedMmsis: ['316001234'] });
    expect(out).toHaveLength(1);
    expect(out[0].severity).toBe('warning');
    expect(out[0].notify).toBe(true);
    expect(out[0].title).toContain('MV SUSPECT');
    expect(out[0].dedupeKey).toBe('derived:sanctions-match:316001234');
    expect(out[0].confidence).toBeCloseTo(0.8, 2);
  });

  it('is a clean no-op when the list is empty or missing', () => {
    const ctx = makeContext({ movers: [vessel({ mmsi: '316001234' })] });
    expect(sanctionsMatch(ctx, {})).toHaveLength(0);
    expect(sanctionsMatch(ctx, { sanctionedMmsis: [] })).toHaveLength(0);
    expect(sanctionsMatch(ctx, { sanctionedMmsis: 'not-an-array' })).toHaveLength(0);
  });

  it('only matches movers of kind vessel', () => {
    const aircraft = { ...vessel({ mmsi: '316001234' }), kind: 'aircraft' } as Doc<'entities'>;
    const ctx = makeContext({ movers: [aircraft] });
    expect(sanctionsMatch(ctx, { sanctionedMmsis: ['316001234'] })).toHaveLength(0);
  });
});

// ---- ais-gap-sensitive ----

describe('ais-gap-sensitive', () => {
  it('flags a watched vessel absent from the fresh picture while aisstream is live', () => {
    const ctx = makeContext({
      sources: [source('aisstream', 'live')],
      watchlist: [watchEntry({ mmsi: '316009999', label: 'MV WATCHED' })],
      movers: [vessel({ mmsi: '316001111' })], // some other vessel is fresh
    });
    const out = aisGapSensitive(ctx, {});
    expect(out).toHaveLength(1);
    expect(out[0].severity).toBe('watch');
    expect(out[0].title).toBe('AIS gap on watched vessel MV WATCHED');
    expect(out[0].lat).toBeUndefined(); // honest: no position available here
    expect(out[0].summary).toContain('Gap duration unknown');
    const bucket = Math.floor(NOW / (6 * 3600_000));
    expect(out[0].dedupeKey).toBe(`derived:ais-gap-sensitive:316009999:${bucket}`);
  });

  it('is suppressed when the aisstream source is not live (health gate)', () => {
    for (const status of ['stale', 'down', 'disabled'] as const) {
      const ctx = makeContext({
        sources: [source('aisstream', status)],
        watchlist: [watchEntry({ mmsi: '316009999' })],
      });
      expect(aisGapSensitive(ctx, {})).toHaveLength(0);
    }
    // no source row at all → also suppressed
    const ctx = makeContext({ watchlist: [watchEntry({ mmsi: '316009999' })] });
    expect(aisGapSensitive(ctx, {})).toHaveLength(0);
  });

  it('stays silent when the watched vessel is present and fresh', () => {
    const ctx = makeContext({
      sources: [source('aisstream', 'live')],
      watchlist: [watchEntry({ mmsi: '316009999' })],
      movers: [vessel({ mmsi: '316009999' })],
    });
    expect(aisGapSensitive(ctx, {})).toHaveLength(0);
  });

  it('ignores inactive and non-vessel watchlist entries', () => {
    const ctx = makeContext({
      sources: [source('aisstream', 'live')],
      watchlist: [
        watchEntry({ mmsi: '316008888', active: false }),
        watchEntry({ mmsi: 'C-GABC', kind: 'aircraft' }),
      ],
    });
    expect(aisGapSensitive(ctx, {})).toHaveLength(0);
  });
});
