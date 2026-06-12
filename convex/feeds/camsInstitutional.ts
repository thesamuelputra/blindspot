import { v } from 'convex/values';
import { internalAction, internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { fetchSource } from '../lib/fetchSource';
import { reportSuccess, reportFailure, type SourceMeta } from '../lib/ingest';

// camsInstitutional — institutional / educational / wildlife / recreation cameras
// for the Cameras & Live Media cluster. Three SOURCES.md health rows, one each:
//   hakai-webcams      4 Hakai Institute snapshot JPEGs (Victoria + Quadra Island)
//   bmsc-cams          2 Bamfield Marine Sciences Centre ipcamlive iframe embeds
//   tofino-org-cams    2 org-run YouTube LIVE harbour/surf cams (Tofino)
//
// Catalog is static — every URL curl-verified live 2026-06-11:
//   - Hakai snapshots: GET, must be 200 image/* (each returned image/jpeg with a
//     Last-Modified seconds old). These are the institute's PUBLIC webcams
//     ("We've made a number of our webcams available to the public",
//     hakai.org/live-webcams); Victoria/Quadra are the VI-scope subset of the
//     hecate.hakai.org/webcams portal. Calvert Island / Koeye / Rivers Inlet /
//     Klinaklini cams on the same host are central-coast (51.6N+), outside VI
//     and deliberately NOT seeded.
//   - BMSC cams: the centre embeds two ipcamlive players on its own
//     bamfieldmsc.com/webcam page. ipcamlive's snapshot needs a dynamic
//     streamid (not in static HTML), so — exactly like extraCams' Courtenay
//     Airpark rtsp.me case — we iframe the sanctioned player page and verify
//     it returns 200, never scrape a frame. Marine station run by UVic/UBC/SFU/
//     UAlberta/UCalgary on Barkley Sound.
//   - Tofino YouTube lives: stable channel-based embeds (survive video-ID
//     rotation on stream restart). Both channels confirmed isLiveNow:true at
//     verification (Long Beach Lodge UCuZpFoR29hw2aw_crGm6zzg JZ3UV60ykqc;
//     Tofino Sea Kayaking UCI9uYhsZi3ulMfWAjVNHUSg _qN4aao5kWc). Liveness on a
//     channel embed is a 200 page check; a permanently-dark channel returns the
//     player shell but YouTube still 200s it, so this catches deleted channels
//     only — a channel going off-air between streams is not flagged here.
//
// Geo note: several cams sit just WEST of VI_BBOX's -125.3 edge — the Tofino
// pair (~-125.88/-125.91) and Bamfield (~-125.14 is inside; outer-coast VI).
// Quadra Island (~50.1, -125.2) and Victoria (~48.43) are in-box. The bbox
// filter is intentionally NOT applied to this hand-curated VI list (same
// rationale as extraCams).
// Worst case: 8 camera rows, 8 outbound probes per daily sync.

const CLUSTER = 'Cameras & Live Media';
const CADENCE = 86_400;

const METAS: Record<string, SourceMeta> = {
  'hakai-webcams': {
    slug: 'hakai-webcams',
    name: 'Hakai Institute Webcams',
    cluster: CLUSTER,
    cadenceSec: CADENCE,
    attribution: 'Hakai Institute',
    licenseNote: 'Publicly published webcams (hakai.org/live-webcams); no formal redistribution licence — hotlink gently, drop on request',
  },
  'bmsc-cams': {
    slug: 'bmsc-cams',
    name: 'Bamfield Marine Sciences Centre Cams',
    cluster: CLUSTER,
    cadenceSec: CADENCE,
    attribution: 'Bamfield Marine Sciences Centre',
    licenseNote: 'ipcamlive players the centre embeds on its own webcam page — iframe the sanctioned embed, never proxy frames',
  },
  'tofino-org-cams': {
    slug: 'tofino-org-cams',
    name: 'Tofino Organization YouTube Cams',
    cluster: CLUSTER,
    cadenceSec: CADENCE,
    attribution: 'Long Beach Lodge Resort · Tofino Sea Kayaking (via YouTube)',
    licenseNote: 'YouTube ToS: playback via iframe player only — never extract HLS',
  },
};

type Check =
  | { kind: 'image' } // GET mediaUrl, expect image/*
  | { kind: 'page' }; // GET mediaUrl, expect 200 (embed pages)

interface CatalogCam {
  slug: string;
  name: string;
  lat: number;
  lng: number;
  kind: 'snapshot' | 'iframe';
  mediaUrl: string;
  refreshSec?: number;
  attribution: string;
  sourceSlug: string;
  check: Check;
}

const ytChannelEmbed = (channelId: string) =>
  `https://www.youtube.com/embed/live_stream?channel=${channelId}`;

// Every URL below returned the expected 200 on 2026-06-11 (image/jpeg with a
// fresh Last-Modified for snapshots; text/html for the iframe/embed pages).
// Coordinates are map-marker approximations of the published cam locations.
const CATALOG: CatalogCam[] = [
  // ---- hakai-webcams ----
  // Hakai snapshots overwrite a single current.jpg; the portal refreshes them
  // ~every 5 min, so refreshSec 300 keeps us off the upstream hard.
  {
    slug: 'hakai:victoria-wharf',
    name: 'Hakai Institute Victoria Lab (Inner Harbour, Wharf St)',
    lat: 48.4256, // Old Victoria Custom House, 1002 Wharf St, Inner Harbour
    lng: -123.3702,
    kind: 'snapshot',
    mediaUrl: 'https://hecate.hakai.org/webcams/images/victoria/wharf/current.jpg',
    refreshSec: 300,
    attribution: 'Hakai Institute',
    sourceSlug: 'hakai-webcams',
    check: { kind: 'image' },
  },
  {
    slug: 'hakai:quadra-tower',
    name: 'Hakai Quadra Island Observatory — Tower Cam',
    lat: 50.1175, // Quadra Field Station, Hyacinthe Bay Rd
    lng: -125.2178,
    kind: 'snapshot',
    mediaUrl: 'https://hecate.hakai.org/webcams/images/quadra/tower/current.jpg',
    refreshSec: 300,
    attribution: 'Hakai Institute',
    sourceSlug: 'hakai-webcams',
    check: { kind: 'image' },
  },
  {
    slug: 'hakai:quadra-bluff',
    name: 'Hakai Quadra Island Observatory — Bluff Cam (Rock Point)',
    lat: 50.119,
    lng: -125.214,
    kind: 'snapshot',
    mediaUrl: 'https://hecate.hakai.org/webcams/images/quadra/bluff/current.jpg',
    refreshSec: 300,
    attribution: 'Hakai Institute',
    sourceSlug: 'hakai-webcams',
    check: { kind: 'image' },
  },
  {
    slug: 'hakai:quadra-hbidock',
    name: 'Hakai Dock at Heriot Bay Inn (Quadra Island)',
    lat: 50.0972, // Heriot Bay, Quadra Island
    lng: -125.2078,
    kind: 'snapshot',
    mediaUrl: 'https://hecate.hakai.org/webcams/images/quadra/hbidock/current.jpg',
    refreshSec: 300,
    attribution: 'Hakai Institute',
    sourceSlug: 'hakai-webcams',
    check: { kind: 'image' },
  },

  // ---- bmsc-cams ----
  {
    slug: 'bmsc:cam1',
    name: 'Bamfield Marine Sciences Centre Cam 1 (Barkley Sound)',
    lat: 48.8355,
    lng: -125.1355,
    kind: 'iframe',
    mediaUrl: 'https://g1.ipcamlive.com/player/player.php?alias=bmsccam1',
    attribution: 'Bamfield Marine Sciences Centre',
    sourceSlug: 'bmsc-cams',
    check: { kind: 'page' },
  },
  {
    slug: 'bmsc:cam2',
    name: 'Bamfield Marine Sciences Centre Cam 2 (Bamfield Inlet)',
    lat: 48.836,
    lng: -125.136,
    kind: 'iframe',
    mediaUrl: 'https://g1.ipcamlive.com/player/player.php?alias=bmsccam2',
    attribution: 'Bamfield Marine Sciences Centre',
    sourceSlug: 'bmsc-cams',
    check: { kind: 'page' },
  },

  // ---- tofino-org-cams ----
  // Both just west of VI_BBOX's -125.3 edge (Tofino is ~-125.9).
  {
    slug: 'ytlive:longbeachlodge-coxbay',
    name: 'Long Beach Lodge Cox Bay Surf Cam (Tofino)',
    lat: 49.1046,
    lng: -125.8822,
    kind: 'iframe',
    mediaUrl: ytChannelEmbed('UCuZpFoR29hw2aw_crGm6zzg'),
    attribution: 'Long Beach Lodge Resort via YouTube',
    sourceSlug: 'tofino-org-cams',
    check: { kind: 'page' },
  },
  {
    slug: 'ytlive:tofinoseakayaking-harbour',
    name: 'Tofino Harbour Live Cam (Tofino Sea Kayaking)',
    lat: 49.1527,
    lng: -125.9065,
    kind: 'iframe',
    mediaUrl: ytChannelEmbed('UCI9uYhsZi3ulMfWAjVNHUSg'),
    attribution: 'Tofino Sea Kayaking via YouTube',
    sourceSlug: 'tofino-org-cams',
    check: { kind: 'page' },
  },
];

export interface CameraResult extends Omit<CatalogCam, 'check'> {
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
    if (cam.check.kind === 'image') {
      const type = res.headers.get('content-type') ?? '';
      if (!type.startsWith('image/')) return { alive: false, error: `not an image: ${type}` };
    }
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
      // Sequential on purpose — 8 probes once a day, several against small
      // research-station / volunteer hosts we promised to treat gently.
      for (const cam of CATALOG) {
        const { alive, error } = await isAlive(cam);
        cams.push({
          slug: cam.slug,
          name: cam.name,
          lat: cam.lat,
          lng: cam.lng,
          kind: cam.kind,
          mediaUrl: cam.mediaUrl,
          refreshSec: cam.refreshSec,
          attribution: cam.attribution,
          sourceSlug: cam.sourceSlug,
          active: alive,
        });
        const src = bySource.get(cam.sourceSlug);
        if (src) {
          src.total++;
          if (alive) src.live++;
          else if (error) src.lastError = `${cam.slug}: ${error}`.slice(0, 300);
        }
      }
      await ctx.runMutation(internal.feeds.camsInstitutional.ingest, {
        cams,
        sources: [...bySource.values()],
      });
    } catch (e) {
      await ctx.runMutation(internal.feeds.camsInstitutional.fail, { error: String(e) });
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
        kind: c.kind,
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
    // One health row per SOURCES.md entry. A source with zero live cams is a
    // real failure (these URLs were all verified working) — flag it.
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
