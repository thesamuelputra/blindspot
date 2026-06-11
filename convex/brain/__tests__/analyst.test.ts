// Fixture tests for the analyst's pure helpers (ARCHITECTURE §7.4):
// final-response parsing, highlight validation, arg sanitization, Turf near
// filter, and row compaction (raw/provenance stripped).
import { describe, it, expect } from 'vitest';
import { parseAnalystResponse, validateHighlights, numOr } from '../analyst';
import { withinKm, clampLimit, compactSignal, compactEntity } from '../analystTools';
import type { Doc } from '../../_generated/dataModel';

describe('parseAnalystResponse', () => {
  it('parses a fenced JSON block with prose and highlights', () => {
    const text = [
      'Here is my analysis.',
      '```json',
      JSON.stringify({
        prose: 'Two quakes in the last 6 hours, both minor.',
        highlights: {
          signalIds: ['sig1', 'sig2'],
          entityIds: [],
          bbox: [-125.3, 48.2, -123.1, 51.1],
        },
      }),
      '```',
    ].join('\n');
    const result = parseAnalystResponse(text);
    expect(result.prose).toBe('Two quakes in the last 6 hours, both minor.');
    expect(result.highlights).toEqual({
      signalIds: ['sig1', 'sig2'],
      entityIds: [],
      bbox: [-125.3, 48.2, -123.1, 51.1],
    });
  });

  it('uses the LAST fenced block when several are present', () => {
    const text = [
      '```json',
      '{"prose": "draft"}',
      '```',
      'thinking...',
      '```json',
      '{"prose": "final answer"}',
      '```',
    ].join('\n');
    expect(parseAnalystResponse(text).prose).toBe('final answer');
  });

  it('parses bare JSON without fences', () => {
    const result = parseAnalystResponse('{"prose": "All quiet.", "highlights": {"signalIds": ["a"], "entityIds": []}}');
    expect(result.prose).toBe('All quiet.');
    expect(result.highlights?.signalIds).toEqual(['a']);
  });

  it('falls back to whole text as prose when no JSON is present', () => {
    const result = parseAnalystResponse('No structured block here, just words.');
    expect(result.prose).toBe('No structured block here, just words.');
    expect(result.highlights).toBeUndefined();
  });

  it('falls back to whole text when the fenced JSON is malformed', () => {
    const text = 'Answer.\n```json\n{"prose": "broken\n```';
    const result = parseAnalystResponse(text);
    expect(result.prose).toBe(text.trim());
  });

  it('falls back when the JSON has no string prose', () => {
    const text = '```json\n{"highlights": {"signalIds": ["x"]}}\n```';
    const result = parseAnalystResponse(text);
    expect(result.prose).toBe(text.trim());
  });

  it('drops an invalid bbox but keeps valid ids', () => {
    const text =
      '```json\n' +
      JSON.stringify({
        prose: 'ok',
        highlights: { signalIds: ['s'], entityIds: [], bbox: [1, 2, 3] },
      }) +
      '\n```';
    const result = parseAnalystResponse(text);
    expect(result.highlights?.signalIds).toEqual(['s']);
    expect(result.highlights?.bbox).toBeUndefined();
  });

  it('omits highlights entirely when they carry nothing valid', () => {
    const text =
      '```json\n' +
      JSON.stringify({ prose: 'ok', highlights: { signalIds: [], entityIds: [] } }) +
      '\n```';
    expect(parseAnalystResponse(text).highlights).toBeUndefined();
  });
});

describe('validateHighlights', () => {
  it('filters non-string ids', () => {
    const h = validateHighlights({ signalIds: ['a', 7, null, 'b'], entityIds: [{}] });
    expect(h).toEqual({ signalIds: ['a', 'b'], entityIds: [] });
  });

  it('rejects non-object input', () => {
    expect(validateHighlights('nope')).toBeUndefined();
    expect(validateHighlights(['a'])).toBeUndefined();
    expect(validateHighlights(undefined)).toBeUndefined();
  });

  it('accepts a bbox-only highlight', () => {
    const h = validateHighlights({ bbox: [-124, 48.5, -123.5, 49] });
    expect(h).toEqual({ signalIds: [], entityIds: [], bbox: [-124, 48.5, -123.5, 49] });
  });

  it('rejects a bbox with non-finite members', () => {
    expect(validateHighlights({ bbox: [-124, 48.5, Infinity, 49] })).toBeUndefined();
  });
});

describe('numOr', () => {
  it('clamps and falls back', () => {
    expect(numOr(50, 100, 1, 200)).toBe(50);
    expect(numOr(9999, 100, 1, 200)).toBe(200);
    expect(numOr(-5, 100, 1, 200)).toBe(1);
    expect(numOr('abc', 100, 1, 200)).toBe(100);
    expect(numOr(undefined, 100, 1, 200)).toBe(100);
    expect(numOr(NaN, 100, 1, 200)).toBe(100);
  });
});

describe('clampLimit', () => {
  it('clamps into [1, max] with fallback', () => {
    expect(clampLimit(undefined, 50, 200)).toBe(50);
    expect(clampLimit(500, 50, 200)).toBe(200);
    expect(clampLimit(0, 50, 200)).toBe(1);
    expect(clampLimit(33.9, 50, 200)).toBe(33);
    expect(clampLimit(NaN, 50, 200)).toBe(50);
  });
});

describe('withinKm (Turf near post-filter)', () => {
  const victoria = { lat: 48.4284, lng: -123.3656, km: 10 };

  it('keeps a point inside the radius', () => {
    // Esquimalt is roughly 4 km west of downtown Victoria.
    expect(withinKm(48.4306, -123.4147, victoria)).toBe(true);
  });

  it('drops a point outside the radius', () => {
    // Nanaimo is roughly 90 km north of Victoria.
    expect(withinKm(49.1659, -123.9401, victoria)).toBe(false);
  });
});

describe('row compaction strips raw and provenance', () => {
  it('compactSignal keeps analyst fields and drops raw/provenance/geojson', () => {
    const doc = {
      _id: 'signals:abc',
      _creationTime: 1,
      sourceSlug: 'usgs-quakes',
      kind: 'earthquake',
      title: 'M 3.1 off Sooke',
      summary: 'Minor quake offshore',
      severity: 'info',
      lat: 48.3,
      lng: -123.9,
      geojson: '{"type":"Point"}',
      observedAt: 1765432100000,
      dedupeKey: 'usgs-quakes:abc',
      confidence: 1,
      provenance: '{"method":"poll"}',
      raw: '{"huge":"payload"}',
    } as unknown as Doc<'signals'>;
    const row = compactSignal(doc);
    expect(row.id).toBe('signals:abc');
    expect(row.title).toBe('M 3.1 off Sooke');
    expect(row.severity).toBe('info');
    expect(row).not.toHaveProperty('raw');
    expect(row).not.toHaveProperty('provenance');
    expect(row).not.toHaveProperty('geojson');
    expect(row).not.toHaveProperty('dedupeKey');
  });

  it('compactEntity keeps position fields and drops state JSON', () => {
    const doc = {
      _id: 'entities:xyz',
      _creationTime: 1,
      kind: 'vessel',
      extId: '316001234',
      label: 'COASTAL RANGER',
      sourceSlug: 'aisstream',
      lat: 48.5,
      lng: -123.2,
      heading: 270,
      speed: 12.4,
      state: '{"navStatus":"underway"}',
      firstSeenAt: 1765000000000,
      lastSeenAt: 1765432100000,
      stale: false,
      watch: true,
    } as unknown as Doc<'entities'>;
    const row = compactEntity(doc);
    expect(row.id).toBe('entities:xyz');
    expect(row.label).toBe('COASTAL RANGER');
    expect(row.watch).toBe(true);
    expect(row).not.toHaveProperty('state');
    expect(row).not.toHaveProperty('sourceSlug');
  });
});
