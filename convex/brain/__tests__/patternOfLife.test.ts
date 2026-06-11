import { describe, expect, it } from 'vitest';
import { foldTracks, parsePattern, type TrackPoint } from '../patternOfLife';

// Synthetic fixtures over the pure pattern-of-life fold (ARCHITECTURE §7.10/§13):
// incremental cursor, streak carry-over across runs, corridor cap, 30d pruning.

const DAY = 86_400_000;
const NOW = 1_765_000_000_000; // fixed epoch

function moored(at: number): TrackPoint {
  return { at, lat: 48.4321, lng: -123.3812, speed: 0.2 };
}

describe('foldTracks', () => {
  it('builds a profile from a moored vessel and counts one visit per stay', () => {
    const points: TrackPoint[] = [];
    for (let i = 0; i < 10; i++) points.push(moored(NOW - 10 * 3600_000 + i * 3600_000));
    const p = foldTracks(parsePattern(undefined), points, NOW);
    expect(p.dwellSites.length).toBe(1);
    expect(p.dwellSites[0].visits).toBe(1); // one continuous stay, not 10
    expect(p.activeHoursUtc.reduce((a, b) => a + b, 0)).toBe(10); // 10 distinct hour slots
    expect(p.sightingsLast30d).toBeGreaterThanOrEqual(1);
    expect(p.lastFoldedAt).toBe(points[points.length - 1].at);
  });

  it('is incremental: refolding the same window adds nothing', () => {
    const points: TrackPoint[] = [];
    for (let i = 0; i < 10; i++) points.push(moored(NOW - 10 * 3600_000 + i * 3600_000));
    const first = foldTracks(parsePattern(undefined), points, NOW);
    const second = foldTracks(first, points, NOW + DAY);
    expect(second.dwellSites[0].visits).toBe(first.dwellSites[0].visits);
    expect(second.activeHoursUtc).toEqual(first.activeHoursUtc);
  });

  it('does not double count a stay spanning two runs (streak cursor)', () => {
    const run1: TrackPoint[] = [moored(NOW - 2 * 3600_000), moored(NOW - 3600_000)];
    const run2: TrackPoint[] = [moored(NOW + 3600_000), moored(NOW + 2 * 3600_000)];
    const p1 = foldTracks(parsePattern(undefined), run1, NOW);
    const p2 = foldTracks(p1, run2, NOW + DAY);
    expect(p2.dwellSites[0].visits).toBe(1);
  });

  it('keeps last 3 corridors and prunes 30d sightings', () => {
    let p = parsePattern(undefined);
    for (let d = 0; d < 40; d++) {
      const base = NOW - (40 - d) * DAY;
      const pts: TrackPoint[] = [
        { at: base, lat: 48.4 + d * 0.001, lng: -123.4, speed: 8 },
        { at: base + 600_000, lat: 48.5 + d * 0.001, lng: -123.5, speed: 8 },
        { at: base + 1_200_000, lat: 48.6 + d * 0.001, lng: -123.6, speed: 8 },
      ];
      p = foldTracks(p, pts, base + 1_300_000);
    }
    expect(p.corridors.length).toBe(3);
    expect(p.sightingsLast30d).toBeLessThanOrEqual(31);
    expect(p.sightingsLast30d).toBeGreaterThanOrEqual(28);
  });

  it('separates dwell sites and ranks by visits', () => {
    const a = { lat: 48.43, lng: -123.38 };
    const b = { lat: 49.21, lng: -124.0 };
    const pts: TrackPoint[] = [];
    let t = NOW - 20 * 3600_000;
    // 3 stays at A, 1 at B, with fast transits between
    for (const stop of [a, b, a, a]) {
      pts.push({ at: t, lat: stop.lat, lng: stop.lng, speed: 0.3 });
      pts.push({ at: t + 600_000, lat: stop.lat, lng: stop.lng, speed: 0.3 });
      pts.push({ at: t + 1_800_000, lat: stop.lat + 0.3, lng: stop.lng + 0.3, speed: 14 });
      t += 4 * 3600_000;
    }
    const p = foldTracks(parsePattern(undefined), pts, NOW);
    expect(p.dwellSites[0].visits).toBe(3);
    expect(p.dwellSites.length).toBeGreaterThanOrEqual(2);
  });

  it('survives malformed stored JSON', () => {
    expect(parsePattern('{not json').lastFoldedAt).toBe(0);
    expect(parsePattern('{"v":9,"activeHoursUtc":[1,2]}').activeHoursUtc.length).toBe(24);
  });
});
