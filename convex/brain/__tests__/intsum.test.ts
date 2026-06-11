import { describe, expect, it } from 'vitest';
import {
  buildUserPrompt,
  countByKind,
  extractText,
  pickTopSignals,
  rankSeverity,
  shouldStoreUnavailable,
  utc,
  UNAVAILABLE_TEXT,
  type IntsumSnapshot,
} from '../intsum';

const HOUR = 3600_000;
const NOW = Date.UTC(2026, 5, 11, 8, 0, 0); // 2026-06-11T08:00Z

function snapshotFixture(overrides: Partial<IntsumSnapshot> = {}): IntsumSnapshot {
  return {
    at: NOW,
    signalCounts6h: { earthquake: 3, wildfire: 12, derived: 1 },
    topSignals: [
      { kind: 'wildfire', title: 'New fire near Port Alberni', severity: 'warning', observedAt: NOW - HOUR },
      { kind: 'earthquake', title: 'M2.1 off Tofino', severity: 'info', observedAt: NOW - 2 * HOUR },
    ],
    activeAlerts: [{ headline: 'Wind warning for east Vancouver Island', severity: 'watch' }],
    threat: { level: 'ELEVATED', score: 42.5, computedAt: NOW - 15 * 60_000 },
    sourceHealth: { live: 50, stale: 3, down: 1, disabled: 2 },
    moverCounts: { vessel: 180, aircraft: 22 },
    ...overrides,
  };
}

describe('rankSeverity', () => {
  it('orders critical > warning > watch > info', () => {
    expect(rankSeverity('critical')).toBeGreaterThan(rankSeverity('warning'));
    expect(rankSeverity('warning')).toBeGreaterThan(rankSeverity('watch'));
    expect(rankSeverity('watch')).toBeGreaterThan(rankSeverity('info'));
  });

  it('treats unknown severities as info-grade', () => {
    expect(rankSeverity('bogus')).toBe(rankSeverity('info'));
  });
});

describe('countByKind', () => {
  it('counts rows per kind', () => {
    const counts = countByKind([
      { kind: 'earthquake' },
      { kind: 'wildfire' },
      { kind: 'earthquake' },
    ]);
    expect(counts).toEqual({ earthquake: 2, wildfire: 1 });
  });

  it('returns an empty object for no rows', () => {
    expect(countByKind([])).toEqual({});
  });
});

describe('pickTopSignals', () => {
  const rows = [
    { severity: 'info', observedAt: NOW - 1000 },
    { severity: 'critical', observedAt: NOW - 5 * HOUR },
    { severity: 'warning', observedAt: NOW - HOUR },
    { severity: 'warning', observedAt: NOW - 10_000 },
  ];

  it('sorts by severity first, recency second', () => {
    const top = pickTopSignals(rows);
    expect(top[0].severity).toBe('critical');
    expect(top[1]).toEqual({ severity: 'warning', observedAt: NOW - 10_000 });
    expect(top[2]).toEqual({ severity: 'warning', observedAt: NOW - HOUR });
    expect(top[3].severity).toBe('info');
  });

  it('caps at the limit and does not mutate the input', () => {
    const copy = [...rows];
    expect(pickTopSignals(rows, 2)).toHaveLength(2);
    expect(rows).toEqual(copy);
  });
});

describe('utc', () => {
  it('renders minute-resolution UTC', () => {
    expect(utc(NOW)).toBe('2026-06-11T08:00Z');
  });
});

describe('buildUserPrompt', () => {
  it('includes threat, source health, movers, counts, alerts, and top signals', () => {
    const prompt = buildUserPrompt(snapshotFixture());
    expect(prompt).toContain('Snapshot time: 2026-06-11T08:00Z');
    expect(prompt).toContain('Threat level: ELEVATED (score 42.5');
    expect(prompt).toContain('Source health: 50 live, 3 stale, 1 down, 2 disabled');
    expect(prompt).toContain('vessel 180');
    expect(prompt).toContain('wildfire 12');
    expect(prompt).toContain('[watch] Wind warning for east Vancouver Island');
    expect(prompt).toContain('[warning] wildfire: New fire near Port Alberni (2026-06-11T07:00Z)');
  });

  it('degrades cleanly when the console is empty', () => {
    const prompt = buildUserPrompt(
      snapshotFixture({
        signalCounts6h: {},
        topSignals: [],
        activeAlerts: [],
        threat: null,
        moverCounts: {},
      }),
    );
    expect(prompt).toContain('Threat level: not yet computed');
    expect(prompt).toContain('Movers tracked (last 10 min): none');
    expect(prompt).toContain('Signal counts (last 6h): none');
    expect(prompt).toMatch(/Active alerts:\n {2}none/);
    expect(prompt).toMatch(/Top signals \(by severity, then recency\):\n {2}none/);
  });
});

describe('extractText', () => {
  it('joins text blocks from a Messages API response', () => {
    const response = {
      id: 'msg_123',
      type: 'message',
      role: 'assistant',
      model: 'claude-haiku-4-5',
      content: [
        { type: 'text', text: 'BLUF: all quiet.' },
        { type: 'tool_use', id: 'toolu_1', name: 'x', input: {} },
        { type: 'text', text: 'Sources nominal.' },
      ],
      stop_reason: 'end_turn',
    };
    expect(extractText(response)).toBe('BLUF: all quiet.\nSources nominal.');
  });

  it('returns empty string for malformed payloads', () => {
    expect(extractText(null)).toBe('');
    expect(extractText('nope')).toBe('');
    expect(extractText({})).toBe('');
    expect(extractText({ content: 'not-an-array' })).toBe('');
    expect(extractText({ content: [{ type: 'text' }] })).toBe('');
  });
});

describe('shouldStoreUnavailable', () => {
  it('stores when there is no prior intsum', () => {
    expect(shouldStoreUnavailable(null, NOW)).toBe(true);
  });

  it('stores when the newest row is a real digest', () => {
    expect(shouldStoreUnavailable({ at: NOW - 1000, text: 'BLUF: all quiet.' }, NOW)).toBe(true);
  });

  it('skips when an unavailable marker is younger than 24h', () => {
    expect(shouldStoreUnavailable({ at: NOW - 4 * HOUR, text: UNAVAILABLE_TEXT }, NOW)).toBe(false);
  });

  it('stores again once the marker is 24h old', () => {
    expect(shouldStoreUnavailable({ at: NOW - 24 * HOUR, text: UNAVAILABLE_TEXT }, NOW)).toBe(true);
  });
});
