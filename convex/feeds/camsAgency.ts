import { v } from 'convex/values';
import { internalAction, internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { fetchSource } from '../lib/fetchSource';
import { reportSuccess, reportFailure, type SourceMeta } from '../lib/ingest';

// camsAgency — GOVERNMENT / AGENCY / TRANSPORT snapshot cams on the shared
// Salish Sea, BEYOND DriveBC (which the sibling drivebcCams.ts owns) and beyond
// the BC Ferries terminal cams (extraCams.ts owns those). Everything here is
// Washington State DOT: the only institutional, key-free, openly-served traffic
// imagery watching VI-relevant waters from the US side of the strait.
//
// Two health rows, one per SOURCES.md-style entry:
//   wsdot-ferry-cams  Washington State Ferries terminal cams on the
//                     Anacortes-San Juans-Sidney BC corridor + the Coupeville/
//                     Port Townsend run across Admiralty Inlet (the SE mouth of
//                     the Strait of Juan de Fuca).
//   wsdot-strait-cams US-101 highway cams along the south shore of the Strait
//                     of Juan de Fuca around Port Angeles (the Coho ferry port
//                     to Victoria) and Diamond Point.
//
// SCOPE NOTE: every cam here is intentionally OUTSIDE VI_BBOX — they sit on the
// US south/east shore of the shared waters (lat ~48.0-48.6, lng east of the box
// edge -123.1). The brief flags Washington-side Salish Sea cams (WSF, Port
// Angeles) as in-scope precisely because they watch VI-relevant waters: the
// Anacortes ferry is the only WSF route that lands on Vancouver Island (Sidney
// BC), the San Juans sit mid-strait between the island and the mainland, and
// the US-101 cams look across the Strait of Juan de Fuca toward Victoria. The
// bbox filter is deliberately NOT applied to this hand-curated list (same
// posture as extraCams.ts for its west-edge VI cams).
//
// Every image URL came from WSDOT's no-auth HighwayCameras KML
// (https://wsdot.wa.gov/traffic/api/HighwayCameras/kml.aspx) and was
// curl-verified 200 image/jpeg on 2026-06-11. The full Traveler API
// (HighwayCamerasREST) needs a registered AccessCode; the static image host
// images.wsdot.wa.gov does not, so we poll the documented snapshot URLs
// directly. Upstream refreshes ~1-2 min; refreshSec stays conservative.
//
// Daily sync re-verifies liveness (GET, require image/*) and flips `active`
// instead of dropping rows. Worst case: 11 camera rows, 11 outbound probes/day.

const CLUSTER = 'Cameras & Live Media';
const CADENCE = 86_400;

const METAS: Record<string, SourceMeta> = {
  'wsdot-ferry-cams': {
    slug: 'wsdot-ferry-cams',
    name: 'WSF Salish Sea Terminal Cams',
    cluster: CLUSTER,
    cadenceSec: CADENCE,
    attribution: 'Washington State Ferries / WSDOT',
    licenseNote:
      'WSDOT public traffic imagery, key-free static host (images.wsdot.wa.gov). No formal ToS reviewed — cache server-side, attribute, low volume, removable.',
  },
  'wsdot-strait-cams': {
    slug: 'wsdot-strait-cams',
    name: 'WSDOT Strait of Juan de Fuca Cams (US-101)',
    cluster: CLUSTER,
    cadenceSec: CADENCE,
    attribution: 'Washington State DOT (WSDOT)',
    licenseNote:
      'WSDOT public traffic imagery, key-free static host (images.wsdot.wa.gov). No formal ToS reviewed — cache server-side, attribute, low volume, removable.',
  },
};

interface CatalogCam {
  slug: string;
  name: string;
  lat: number;
  lng: number;
  mediaUrl: string;
  refreshSec: number;
  attribution: string;
  sourceSlug: string;
}

const WSF_ATTR = 'Washington State Ferries / WSDOT';
const WSDOT_ATTR = 'Washington State DOT (WSDOT)';

// All URLs returned 200 image/jpeg on 2026-06-11. Coordinates are from the
// WSDOT KML placemark for each cam.
const CATALOG: CatalogCam[] = [
  // ---- wsdot-ferry-cams ----
  // Anacortes: WSF terminal for the San Juans AND the international run to
  // Sidney BC (Vancouver Island) — the only WSF route that lands on VI.
  {
    slug: 'wsdot:wsf-anacortes-terminal',
    name: 'WSF Anacortes Ferry Terminal (Sidney BC / San Juans route)',
    lat: 48.505975,
    lng: -122.679048,
    mediaUrl: 'https://images.wsdot.wa.gov/wsf/anacortes/terminal/anaterm.jpg',
    refreshSec: 90,
    attribution: WSF_ATTR,
    sourceSlug: 'wsdot-ferry-cams',
  },
  {
    slug: 'wsdot:wsf-anacortes-holding',
    name: 'WSF Anacortes Ferry Holding',
    lat: 48.503437,
    lng: -122.679509,
    mediaUrl: 'https://images.wsdot.wa.gov/wsf/anacortes/holding/anahold.jpg',
    refreshSec: 90,
    attribution: WSF_ATTR,
    sourceSlug: 'wsdot-ferry-cams',
  },
  // San Juan Islands terminals — mid-strait between VI and the mainland, on the
  // Anacortes-San Juans-Sidney corridor watching the shared Salish Sea.
  {
    slug: 'wsdot:wsf-fridayharbor-holding',
    name: 'WSF Friday Harbor Ferry Holding (San Juan Island)',
    lat: 48.5351,
    lng: -123.0066,
    mediaUrl: 'https://images.wsdot.wa.gov/wsf/fridayharbor/friholding.jpg',
    refreshSec: 90,
    attribution: WSF_ATTR,
    sourceSlug: 'wsdot-ferry-cams',
  },
  {
    slug: 'wsdot:wsf-lopez-approach',
    name: 'WSF Lopez Island Ferry Approach',
    lat: 48.56895,
    lng: -122.884565,
    mediaUrl: 'https://images.wsdot.wa.gov/wsf/lopez/approach.jpg',
    refreshSec: 90,
    attribution: WSF_ATTR,
    sourceSlug: 'wsdot-ferry-cams',
  },
  {
    slug: 'wsdot:wsf-orcas-holding',
    name: 'WSF Orcas Island Ferry Holding',
    lat: 48.598694,
    lng: -122.945556,
    mediaUrl: 'https://images.wsdot.wa.gov/wsf/orcas/holding.jpg',
    refreshSec: 90,
    attribution: WSF_ATTR,
    sourceSlug: 'wsdot-ferry-cams',
  },
  // Admiralty Inlet — the SE mouth of the Strait of Juan de Fuca. The
  // Coupeville (Keystone) <-> Port Townsend run crosses the strait entrance.
  {
    slug: 'wsdot:wsf-porttownsend-terminal',
    name: 'WSF Port Townsend Ferry Terminal (Admiralty Inlet)',
    lat: 48.112086,
    lng: -122.760466,
    mediaUrl: 'https://images.wsdot.wa.gov/wsf/PortTownsend/terminal/ptterm.jpg',
    refreshSec: 90,
    attribution: WSF_ATTR,
    sourceSlug: 'wsdot-ferry-cams',
  },
  {
    slug: 'wsdot:wsf-coupeville-terminal',
    name: 'WSF Coupeville (Keystone) Ferry Terminal (Whidbey Island)',
    lat: 48.159349,
    lng: -122.672701,
    mediaUrl: 'https://images.wsdot.wa.gov/wsf/Keystone/terminal/keyterm.jpg',
    refreshSec: 90,
    attribution: WSF_ATTR,
    sourceSlug: 'wsdot-ferry-cams',
  },

  // ---- wsdot-strait-cams ----
  // US-101 along the south shore of the Strait of Juan de Fuca. Port Angeles is
  // the Coho ferry port to Victoria; Diamond Point overlooks the strait east of
  // Sequim. /orflow JPEGs refresh fast; /rweather are slower weather stills.
  {
    slug: 'wsdot:us101-brook-ave',
    name: 'US-101 Brook Ave, Port Angeles (Strait of Juan de Fuca)',
    lat: 48.104589,
    lng: -123.380874,
    mediaUrl: 'https://images.wsdot.wa.gov/orflow/101vc25064.jpg',
    refreshSec: 60,
    attribution: WSDOT_ATTR,
    sourceSlug: 'wsdot-strait-cams',
  },
  {
    slug: 'wsdot:us101-kolonels-way',
    name: 'US-101 Kolonels Way, Port Angeles (Coho ferry approach)',
    lat: 48.108394,
    lng: -123.363103,
    mediaUrl: 'https://images.wsdot.wa.gov/orflow/101vc25153.jpg',
    refreshSec: 60,
    attribution: WSDOT_ATTR,
    sourceSlug: 'wsdot-strait-cams',
  },
  {
    slug: 'wsdot:us101-siebert-creek',
    name: 'US-101 Siebert Creek, east of Port Angeles',
    lat: 48.09373,
    lng: -123.27507,
    mediaUrl: 'https://images.wsdot.wa.gov/rweather/Siebert.jpg',
    refreshSec: 180,
    attribution: WSDOT_ATTR,
    sourceSlug: 'wsdot-strait-cams',
  },
  {
    slug: 'wsdot:us101-diamond-point',
    name: 'US-101 Diamond Point (overlooks Strait of Juan de Fuca)',
    lat: 48.050278,
    lng: -122.952442,
    mediaUrl: 'https://images.wsdot.wa.gov/rweather/diamond_medium.jpg',
    refreshSec: 180,
    attribution: WSDOT_ATTR,
    sourceSlug: 'wsdot-strait-cams',
  },
];

export interface CameraResult extends CatalogCam {
  active: boolean;
}

export interface SourceResult {
  slug: string;
  live: number;
  total: number;
  lastError?: string;
}

async function isAlive(cam: CatalogCam): Promise<{ alive: boolean; error?: string }> {
  try {
    const res = await fetchSource(cam.mediaUrl, { retries: 0 });
    if (!res.ok) return { alive: false, error: `HTTP ${res.status}` };
    const type = res.headers.get('content-type') ?? '';
    if (!type.startsWith('image/')) return { alive: false, error: `not an image: ${type}` };
    return { alive: true };
  } catch (e) {
    return { alive: false, error: String(e) };
  }
}

export const sync = internalAction({
  args: {},
  handler: async (ctx) => {
    try {
      const cams: CameraResult[] = [];
      const bySource = new Map<string, SourceResult>();
      for (const slug of Object.keys(METAS)) {
        bySource.set(slug, { slug, live: 0, total: 0 });
      }
      // Sequential — 11 probes once a day against one state host; be gentle.
      for (const cam of CATALOG) {
        const { alive, error } = await isAlive(cam);
        cams.push({ ...cam, active: alive });
        const src = bySource.get(cam.sourceSlug);
        if (src) {
          src.total++;
          if (alive) src.live++;
          else if (error) src.lastError = `${cam.slug}: ${error}`.slice(0, 300);
        }
      }
      await ctx.runMutation(internal.feeds.camsAgency.ingest, {
        cams,
        sources: [...bySource.values()],
      });
    } catch (e) {
      await ctx.runMutation(internal.feeds.camsAgency.fail, { error: String(e) });
    }
  },
});

export const ingest = internalMutation({
  args: { cams: v.array(v.any()), sources: v.array(v.any()) },
  handler: async (ctx, args) => {
    const cams = args.cams as CameraResult[];
    const sources = args.sources as SourceResult[];
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
        attribution: c.attribution,
        sourceSlug: c.sourceSlug,
        active: c.active,
      };
      if (existing) {
        await ctx.db.patch(existing._id, fields);
        updated++;
      } else {
        await ctx.db.insert('cameras', { slug: c.slug, ...fields });
        inserted++;
      }
    }
    // Catalog edits can rename slugs across deploys — anything we own that is no
    // longer cataloged goes inactive, never deleted.
    const present = new Set(cams.map((c) => c.slug));
    const ours = new Set(Object.keys(METAS));
    const all = await ctx.db.query('cameras').collect();
    for (const row of all) {
      if (ours.has(row.sourceSlug) && row.active && !present.has(row.slug)) {
        await ctx.db.patch(row._id, { active: false });
      }
    }
    // One health row per source. These URLs were all verified working, so a
    // source with zero live cams is a real failure — flag it.
    for (const s of sources) {
      const meta = METAS[s.slug];
      if (!meta) continue;
      if (s.total === 0 || s.live > 0) {
        await reportSuccess(ctx, meta, s.live);
      } else {
        await reportFailure(ctx, meta, s.lastError ?? 'all cams failed liveness check');
      }
    }
    return { inserted, updated };
  },
});

export const fail = internalMutation({
  args: { error: v.string() },
  handler: async (ctx, { error }) => {
    for (const meta of Object.values(METAS)) {
      await reportFailure(ctx, meta, error);
    }
  },
});
