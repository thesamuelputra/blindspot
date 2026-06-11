import { v } from 'convex/values';
import { simplify } from '@turf/turf';
import { internalAction, internalMutation, internalQuery } from '../_generated/server';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';

// Pattern-of-life folding (ARCHITECTURE §7.10, BRIEF §8.3). Daily cron: for
// each active watchlist row with a live entity, fold the last 48h of tracks
// into the rolling profile stored as JSON on the watchlist row.
//
// INCREMENTAL BY DESIGN: tracks are retained for only 48h (§11), so the
// profile must outlive its inputs. The stored JSON carries a fold cursor
// (`lastFoldedAt` = newest track timestamp already folded); each run only
// folds points newer than the cursor and MERGES the result into the prior
// profile. Dwell visit counts and the hour histogram therefore accumulate
// across weeks even though no run ever sees more than 48h of raw fixes.
//
// Profile JSON shape (versioned, parse defensively):
//   {
//     v: 1,
//     lastFoldedAt,          // fold cursor (ms epoch)
//     streakBucket,          // dwell streak carried across runs (no double count)
//     dwellSites: [{ key, lat, lng, visits, lastAt }],  // top 24 kept, UI shows 5
//     activeHoursUtc: number[24],  // distinct active hour-slots per UTC hour
//     corridors: [{ at, line: [[lng,lat],…] }],         // last 3, Turf-simplified
//     sightingDays: ['YYYY-MM-DD'],                     // pruned to 30d
//     sightingsLast30d,
//     updatedAt,
//   }

const GRID = 0.01; // dwell bucket size in degrees (~1.1km N-S at this latitude)
const DWELL_SPEED_KT = 1;
const MAX_DWELL_SITES = 24; // stored; UI renders top 5
const MAX_CORRIDORS = 3;
const MAX_CORRIDOR_POINTS = 60;
const SIGHTING_WINDOW_DAYS = 30;
const TRACK_WINDOW_MS = 48 * 3600_000;
const TRACK_TAKE = 500;

export interface TrackPoint {
  at: number;
  lat: number;
  lng: number;
  speed?: number;
}

export interface DwellSite {
  key: string; // "lat,lng" bucket center, 2dp
  lat: number;
  lng: number;
  visits: number;
  lastAt: number;
}

export interface PatternJson {
  v: 1;
  lastFoldedAt: number;
  streakBucket: string | null;
  dwellSites: DwellSite[];
  activeHoursUtc: number[];
  corridors: Array<{ at: number; line: Array<[number, number]> }>;
  sightingDays: string[];
  sightingsLast30d: number;
  updatedAt: number;
}

function emptyPattern(): PatternJson {
  return {
    v: 1,
    lastFoldedAt: 0,
    streakBucket: null,
    dwellSites: [],
    activeHoursUtc: new Array<number>(24).fill(0),
    corridors: [],
    sightingDays: [],
    sightingsLast30d: 0,
    updatedAt: 0,
  };
}

export function parsePattern(json: string | undefined): PatternJson {
  if (!json) return emptyPattern();
  try {
    const p = JSON.parse(json) as Partial<PatternJson>;
    const base = emptyPattern();
    return {
      ...base,
      ...p,
      v: 1,
      dwellSites: Array.isArray(p.dwellSites) ? p.dwellSites : [],
      activeHoursUtc:
        Array.isArray(p.activeHoursUtc) && p.activeHoursUtc.length === 24
          ? p.activeHoursUtc
          : base.activeHoursUtc,
      corridors: Array.isArray(p.corridors) ? p.corridors : [],
      sightingDays: Array.isArray(p.sightingDays) ? p.sightingDays : [],
    };
  } catch {
    return emptyPattern();
  }
}

function bucketOf(lat: number, lng: number): { key: string; lat: number; lng: number } {
  const blat = Math.round(lat / GRID) * GRID;
  const blng = Math.round(lng / GRID) * GRID;
  return { key: `${blat.toFixed(2)},${blng.toFixed(2)}`, lat: blat, lng: blng };
}

function utcDay(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

// Turf simplify with fallback: corridor lines must never abort a fold.
function simplifyLine(coords: Array<[number, number]>): Array<[number, number]> {
  let line = coords;
  try {
    const feature = {
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: coords },
    } as Parameters<typeof simplify>[0];
    const out = simplify(feature, { tolerance: 0.005, highQuality: false }) as unknown as {
      geometry: { coordinates: Array<[number, number]> };
    };
    line = out.geometry.coordinates;
  } catch {
    /* keep original */
  }
  if (line.length > MAX_CORRIDOR_POINTS) {
    const step = Math.ceil(line.length / MAX_CORRIDOR_POINTS);
    line = line.filter((_, i) => i % step === 0 || i === line.length - 1);
  }
  return line;
}

// Pure fold: merge new chronological points into the prior profile.
// Exported for fixture tests (§13).
export function foldTracks(prior: PatternJson, points: TrackPoint[], now: number): PatternJson {
  const next: PatternJson = {
    ...prior,
    dwellSites: prior.dwellSites.map((d) => ({ ...d })),
    activeHoursUtc: [...prior.activeHoursUtc],
    corridors: [...prior.corridors],
    sightingDays: [...prior.sightingDays],
  };

  const fresh = points
    .filter((p) => p.at > prior.lastFoldedAt)
    .sort((a, b) => a.at - b.at);

  if (fresh.length > 0) {
    // dwell sites: a "visit" starts when the mover enters a 0.01-degree
    // bucket while dwelling (speed under 1kt, or consecutive fixes landing
    // in the same bucket). The streak bucket persists across runs via the
    // cursor so a vessel moored over the daily boundary counts once.
    const sites = new Map<string, DwellSite>(next.dwellSites.map((d) => [d.key, d]));
    let streak = next.streakBucket;
    let prevBucket: string | null = null;
    for (let i = 0; i < fresh.length; i++) {
      const p = fresh[i];
      const b = bucketOf(p.lat, p.lng);
      const slow = p.speed !== undefined && p.speed < DWELL_SPEED_KT;
      const clustered = prevBucket !== null && prevBucket === b.key;
      if (slow || clustered) {
        if (streak !== b.key) {
          streak = b.key;
          const site = sites.get(b.key);
          if (site) {
            site.visits += 1;
            site.lastAt = p.at;
          } else {
            sites.set(b.key, { key: b.key, lat: b.lat, lng: b.lng, visits: 1, lastAt: p.at });
          }
        } else {
          const site = sites.get(b.key);
          if (site) site.lastAt = p.at;
        }
      } else {
        streak = null;
      }
      prevBucket = b.key;
    }
    next.streakBucket = streak;
    next.dwellSites = [...sites.values()]
      .sort((a, b) => b.visits - a.visits || b.lastAt - a.lastAt)
      .slice(0, MAX_DWELL_SITES);

    // active hours: one increment per distinct hour-slot with a fix, so the
    // histogram counts active hours, not fix density
    const seenSlots = new Set<number>();
    for (const p of fresh) {
      const slot = Math.floor(p.at / 3600_000);
      if (seenSlots.has(slot)) continue;
      seenSlots.add(slot);
      next.activeHoursUtc[new Date(p.at).getUTCHours()] += 1;
    }

    // corridors: simplified line of this fold's movement, last 3 kept
    if (fresh.length >= 2) {
      const line = simplifyLine(fresh.map((p) => [p.lng, p.lat] as [number, number]));
      next.corridors = [...next.corridors, { at: now, line }].slice(-MAX_CORRIDORS);
    }

    // sightings: distinct UTC days with at least one fix
    const days = new Set(next.sightingDays);
    for (const p of fresh) days.add(utcDay(p.at));
    next.sightingDays = [...days];

    next.lastFoldedAt = fresh[fresh.length - 1].at;
  }

  // prune the 30d sighting window every run so the counter decays even when
  // the entity goes quiet
  const floor = utcDay(now - SIGHTING_WINDOW_DAYS * 86_400_000);
  next.sightingDays = next.sightingDays.filter((d) => d >= floor).sort();
  next.sightingsLast30d = next.sightingDays.length;
  next.updatedAt = now;
  return next;
}

// Bounded per-entity window read: by_entity_at, newest 500, returned
// chronological. One watchlist row = one query, far under scan limits.
export const tracksWindow = internalQuery({
  args: { entityId: v.id('entities'), since: v.number() },
  handler: async (ctx, { entityId, since }) => {
    const rows = await ctx.db
      .query('tracks')
      .withIndex('by_entity_at', (q) => q.eq('entityId', entityId).gte('at', since))
      .order('desc')
      .take(TRACK_TAKE);
    return rows.reverse().map((r) => ({ at: r.at, lat: r.lat, lng: r.lng, speed: r.speed }));
  },
});

export const savePattern = internalMutation({
  args: { id: v.id('watchlist'), pattern: v.string() },
  handler: async (ctx, { id, pattern }) => {
    const row = await ctx.db.get(id);
    if (!row) return; // unpinned while the fold ran
    await ctx.db.patch(id, { pattern });
  },
});

// Daily cron entry point (wired in convex/crons.ts by the orchestrator).
export const computeAll = internalAction({
  args: {},
  handler: async (ctx): Promise<void> => {
    const now = Date.now();
    const rows = (await ctx.runQuery(internal.watchlist.activeWithEntities, {})) as Array<{
      watchlistId: Id<'watchlist'>;
      entityId: Id<'entities'>;
      kind: string;
      identifier: string;
      pattern?: string;
    }>;
    for (const row of rows) {
      const points = (await ctx.runQuery(internal.brain.patternOfLife.tracksWindow, {
        entityId: row.entityId,
        since: now - TRACK_WINDOW_MS,
      })) as TrackPoint[];
      const next = foldTracks(parsePattern(row.pattern), points, now);
      await ctx.runMutation(internal.brain.patternOfLife.savePattern, {
        id: row.watchlistId,
        pattern: JSON.stringify(next),
      });
    }
  },
});
