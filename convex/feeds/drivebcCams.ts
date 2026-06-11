import { v } from 'convex/values';
import { internalAction, internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { fetchSource } from '../lib/fetchSource';
import { VI_BBOX, inBbox } from '../lib/geo';
import { reportSuccess, reportFailure, type SourceMeta } from '../lib/ingest';

// drivebc-highwaycams — SOURCES.md: Ground (Mobility). Canonical inventory is
// the NEW site API (www.drivebc.ca/api/webcams/) — it alone exposes
// update_period_mean and the stale/delayed flags. Image URL pattern is
// https://www.drivebc.ca/images/{id}.jpg (verified 200 image/jpeg).
// Worst case: ~1060 cams province-wide, ~210 after the VI bbox filter.
// Cadence: slow lane (3600s) — inventory only; frames refresh client-side.
const META: SourceMeta = {
  slug: 'drivebc-highwaycams',
  name: 'DriveBC Highway Webcams',
  cluster: 'Ground (Mobility)',
  cadenceSec: 3600,
  attribution: 'DriveBC / Province of B.C.',
};

const INVENTORY_URL = 'https://www.drivebc.ca/api/webcams/?format=json';
const IMAGE_URL = (id: number) => `https://www.drivebc.ca/images/${id}.jpg`;

// Upstream `orientation` is a compass letter (observed: N/NE/E/SE/S/SW/W/NW).
// 16-point map for safety; anything else stays undefined.
const COMPASS_DEG: Record<string, number> = {
  N: 0, NNE: 22.5, NE: 45, ENE: 67.5,
  E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
  S: 180, SSW: 202.5, SW: 225, WSW: 247.5,
  W: 270, WNW: 292.5, NW: 315, NNW: 337.5,
};

interface UpstreamCam {
  id: number;
  name: string;
  name_override?: string;
  location: { type: string; coordinates: [number, number] }; // [lng, lat]
  orientation?: string | null;
  update_period_mean?: number | null;
  should_appear?: boolean;
}

export interface CameraInput {
  slug: string;
  name: string;
  lat: number;
  lng: number;
  mediaUrl: string;
  refreshSec?: number;
  orientation?: number;
}

export const sync = internalAction({
  args: {},
  handler: async (ctx) => {
    try {
      const res = await fetchSource(INVENTORY_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as UpstreamCam[];
      const cams: CameraInput[] = data
        .filter((c) => {
          if (!c.location?.coordinates) return false;
          if (c.should_appear === false) return false;
          const [lng, lat] = c.location.coordinates;
          return inBbox(lat, lng, VI_BBOX);
        })
        .map((c) => {
          const [lng, lat] = c.location.coordinates;
          const deg = c.orientation ? COMPASS_DEG[c.orientation] : undefined;
          return {
            slug: `drivebc:${c.id}`,
            name: c.name_override || c.name,
            lat,
            lng,
            mediaUrl: IMAGE_URL(c.id),
            refreshSec: typeof c.update_period_mean === 'number' ? c.update_period_mean : undefined,
            orientation: deg,
          };
        });
      await ctx.runMutation(internal.feeds.drivebcCams.ingest, { cams });
    } catch (e) {
      await ctx.runMutation(internal.feeds.drivebcCams.fail, { error: String(e) });
    }
  },
});

export const ingest = internalMutation({
  args: { cams: v.array(v.any()) },
  handler: async (ctx, args) => {
    const cams = args.cams as CameraInput[];
    let inserted = 0;
    let updated = 0;
    for (const c of cams) {
      const existing = await ctx.db
        .query('cameras')
        .withIndex('by_slug', (q) => q.eq('slug', c.slug))
        .unique();
      const fields = {
        name: c.name,
        lat: c.lat,
        lng: c.lng,
        kind: 'snapshot' as const,
        mediaUrl: c.mediaUrl,
        refreshSec: c.refreshSec,
        orientation: c.orientation,
        sourceSlug: META.slug,
        attribution: META.attribution,
        active: true,
      };
      if (existing) {
        await ctx.db.patch(existing._id, fields);
        updated++;
      } else {
        await ctx.db.insert('cameras', { slug: c.slug, ...fields });
        inserted++;
      }
    }
    // Cameras that left the inventory go inactive — never deleted. Table is
    // small (hundreds), so a full collect + JS filter is fine (no by_source index).
    const present = new Set(cams.map((c) => c.slug));
    const all = await ctx.db.query('cameras').collect();
    for (const row of all) {
      if (row.sourceSlug === META.slug && row.active && !present.has(row.slug)) {
        await ctx.db.patch(row._id, { active: false });
      }
    }
    await reportSuccess(ctx, META, cams.length);
    return { inserted, updated };
  },
});

export const fail = internalMutation({
  args: { error: v.string() },
  handler: async (ctx, { error }) => {
    await reportFailure(ctx, META, error);
  },
});
