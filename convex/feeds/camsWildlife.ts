import { v } from 'convex/values';
import { internalAction, internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { fetchSource } from '../lib/fetchSource';
import { reportSuccess, reportFailure, type SourceMeta } from '../lib/ingest';

// camsWildlife — WILDLIFE / NATURE / MARINE-LIFE live cams for the flagship CAM
// WALL, complementing the marine/harbour and institutional camera modules.
// All of these were put online by the operating org/foundation themselves
// (Hancock Wildlife Foundation, Cowichan Estuary Nature Centre, OrcaLab via
// explore.org) — none is a private/residential or default-credential camera.
// Three sources, one health row each; every URL was curl-verified 2026-06-11.
//
//   hancock-eagle-cams   5 Hancock Wildlife Foundation bald-eagle NEST cams in
//                        the Salish Sea / Lower Mainland (Surrey Reserve N+S,
//                        White Rock bluff+wide on Boundary Bay, Gleneagles in
//                        West Vancouver). HWF runs one PUBLIC YouTube channel
//                        per camera and embeds them itself on hancockwildlife.org;
//                        live video IDs ROTATE on every stream restart, so —
//                        instead of pinning a watch id — we store the channel's
//                        stable `embed/live_stream?channel=<UC>` URL (the exact
//                        pattern extraCams uses for the Wickaninnish channel cam).
//                        Liveness is probed against the channel /live tab so an
//                        off-season nest correctly goes `active:false`.
//                        HWF's French Creek (Vancouver Island) and Delta 2 nests
//                        were OFF at verify time and are intentionally not seeded
//                        here — add their channels when they return.
//   cowichan-heron-cam   1 Ozolio snapshot of the Pacific great blue heron
//                        rookery in Wessex Ravine above Cowichan Bay, run by the
//                        Cowichan Estuary Nature Centre (Cowichan Bay, Vancouver
//                        Island). Same Ozolio poster API as Mount Washington in
//                        extraCams: cache-control max-age=900 → refreshSec 900.
//   orcalab-sealion-cam  1 explore.org / OrcaLab seasonal cam at the Steller
//                        sea-lion haul-out on Hanson Island (Johnstone Strait /
//                        Blackfish Sound, northern Vancouver Island waters) —
//                        the same OrcaLab station whose MAIN cam lives in
//                        extraCams; this is a DISTINCT sea-lion-beach feed.
//                        Stored as a YouTube watch id (oEmbed-probed); SOURCES
//                        gotcha: explore.org rotates these live ids, so a fresh
//                        id is a catalog edit and oEmbed only catches deleted/
//                        private videos.
//
// Daily sync (86400s) re-checks liveness and flips `active` instead of dropping
// rows. Liveness probes:
//   - ytlive (channel embed)  → GET the channel /live tab, require "isLive":true
//   - oembed (watch id)       → YouTube oEmbed JSON 200
//   - image  (snapshot)       → GET + image/* content-type
//
// Geography (VI_BBOX = lng -125.3..-123.1, lat 48.2..51.1):
//   - Cowichan Bay heron (48.74, -123.62) is INSIDE the box.
//   - OrcaLab Sea Lion Beach (50.52, -126.84) sits NORTH-WEST of the box edge,
//     exactly like the OrcaLab main cam already hand-curated in extraCams — it
//     IS northern Vancouver Island waters, so the bbox filter is not applied to
//     this curated list.
//   - The five Hancock eagle nests sit on the mainland side of the Salish Sea
//     (Surrey/White Rock/Delta ~49.0-49.05, West Vancouver ~49.37). Coordinates
//     are deliberately NEIGHBOURHOOD-level: HWF does not publish exact nest
//     locations to protect the birds, and neither do we. They are seeded as
//     Pacific-Northwest / Salish Sea wildlife cams under the relaxed posture.
// Worst case: 7 camera rows, 7 outbound probes per daily sync.
//
// EXCLUDED after verification (kept out on purpose, see StructuredOutput):
// HWF French Creek (Vancouver Island) + Harrison Mills + Delta 2 + Gleneagles-S
// (channels exist but were OFF / not broadcasting at verify time — would seed an
// active:false row with nothing to play); Adams River sockeye cam (Adams River
// Salmon Society + View Into the Blue — offline for connectivity until Spring
// 2026, and interior BC, not VI); Stanley Park heron Ozolio cam (City of
// Vancouver — could not extract a stable EMB_ poster id from the JS explore
// page, so not seeded rather than guess); WebcamTaxi / SkylineWebcams VI nature
// cams (Cloudflare-blocked the embed-page probe from this host — left for a
// re-probe from a browser context); Pacific Wild Great Bear Live (BC coast
// wolves/bears, but the live-stream system has been dark since ~2018).

const CLUSTER = 'Cameras & Live Media';
const CADENCE = 86_400;

const METAS: Record<string, SourceMeta> = {
  'hancock-eagle-cams': {
    slug: 'hancock-eagle-cams',
    name: 'Hancock Wildlife Eagle Nest Cams',
    cluster: CLUSTER,
    cadenceSec: CADENCE,
    attribution: 'Hancock Wildlife Foundation (via YouTube)',
    licenseNote:
      'HWF-operated public YouTube nest cams — playback via iframe player only, never extract HLS; live ids rotate so we embed the stable channel live_stream URL',
  },
  'cowichan-heron-cam': {
    slug: 'cowichan-heron-cam',
    name: 'Cowichan Bay Heron Cam',
    cluster: CLUSTER,
    cadenceSec: CADENCE,
    attribution: 'Cowichan Estuary Nature Centre (Cowichan Bay, BC) via Ozolio',
    licenseNote: 'Ozolio poster API, cache-control max-age=900 — cache gently at 15-min cadence, drop on request',
  },
  'orcalab-sealion-cam': {
    slug: 'orcalab-sealion-cam',
    name: 'OrcaLab Sea Lion Beach Cam',
    cluster: CLUSTER,
    cadenceSec: CADENCE,
    attribution: 'explore.org / OrcaLab (Hanson Island, BC) via YouTube',
    licenseNote: 'YouTube ToS: playback via iframe player only — never extract HLS; explore.org rotates the live id',
  },
};

type Check =
  | { kind: 'ytlive'; channelId: string } // GET channel /live tab, require live now
  | { kind: 'oembed'; watch: string } // YouTube watch URL → oEmbed JSON probe
  | { kind: 'image' }; // GET mediaUrl, expect image/*

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

const ytChannelEmbed = (cid: string) => `https://www.youtube.com/embed/live_stream?channel=${cid}`;
const ytEmbed = (id: string) => `https://www.youtube.com/embed/${id}`;
const ytWatch = (id: string) => `https://www.youtube.com/watch?v=${id}`;
const ozolioPoster = (oid: string) => `https://relay.ozolio.com/pub.api?cmd=poster&oid=${oid}`;

// Every URL below returned the expected 200 on 2026-06-11 (text/html for the
// channel embed pages, oEmbed JSON for the watch id, image/jpeg for the Ozolio
// snapshot). All five Hancock channels and the Sea Lion Beach id were
// "isLive":true at verify time. Coordinates are map-marker approximations of the
// published / neighbourhood-level cam locations.
const CATALOG: CatalogCam[] = [
  // ---- hancock-eagle-cams ----
  // Channel ids resolved from the HWF YouTube handles; embed survives live-id
  // rotation. Neighbourhood-level coordinates (exact nests are not published).
  {
    slug: 'hancock:surrres-n',
    name: 'Bald Eagle Nest — Surrey Reserve North (HWF)',
    lat: 49.05,
    lng: -122.79,
    kind: 'iframe',
    mediaUrl: ytChannelEmbed('UC4IK9pldg-YPguvdJIFyGMA'),
    attribution: 'Hancock Wildlife Foundation via YouTube',
    sourceSlug: 'hancock-eagle-cams',
    check: { kind: 'ytlive', channelId: 'UC4IK9pldg-YPguvdJIFyGMA' },
  },
  {
    slug: 'hancock:surrres-s',
    name: 'Bald Eagle Nest — Surrey Reserve South (HWF)',
    lat: 49.0498,
    lng: -122.7906,
    kind: 'iframe',
    mediaUrl: ytChannelEmbed('UCe6Xh_nDVKM9Q4-oXat_nGQ'),
    attribution: 'Hancock Wildlife Foundation via YouTube',
    sourceSlug: 'hancock-eagle-cams',
    check: { kind: 'ytlive', channelId: 'UCe6Xh_nDVKM9Q4-oXat_nGQ' },
  },
  {
    slug: 'hancock:wr-bluff',
    name: 'Bald Eagle Nest — White Rock Bluff, Boundary Bay (HWF)',
    lat: 49.0252,
    lng: -122.8027,
    kind: 'iframe',
    mediaUrl: ytChannelEmbed('UCgHe8e3xAhJfwLNTc7pLwgg'),
    attribution: 'Hancock Wildlife Foundation via YouTube',
    sourceSlug: 'hancock-eagle-cams',
    check: { kind: 'ytlive', channelId: 'UCgHe8e3xAhJfwLNTc7pLwgg' },
  },
  {
    slug: 'hancock:wr-wide',
    name: 'Bald Eagle Nest — White Rock Wide, Boundary Bay (HWF)',
    lat: 49.0248,
    lng: -122.8033,
    kind: 'iframe',
    mediaUrl: ytChannelEmbed('UCZ5V38cF4jSTE56l13eahNQ'),
    attribution: 'Hancock Wildlife Foundation via YouTube',
    sourceSlug: 'hancock-eagle-cams',
    check: { kind: 'ytlive', channelId: 'UCZ5V38cF4jSTE56l13eahNQ' },
  },
  {
    slug: 'hancock:gleneagle-n',
    name: 'Bald Eagle Nest — Gleneagles, West Vancouver (HWF)',
    lat: 49.3702,
    lng: -123.2845,
    kind: 'iframe',
    mediaUrl: ytChannelEmbed('UCMD0aPrkETN6k18dYwAF6pw'),
    attribution: 'Hancock Wildlife Foundation & North Shore Eagle Network via YouTube',
    sourceSlug: 'hancock-eagle-cams',
    check: { kind: 'ytlive', channelId: 'UCMD0aPrkETN6k18dYwAF6pw' },
  },

  // ---- cowichan-heron-cam ----
  // Pacific great blue heron rookery, Wessex Ravine above Cowichan Bay; the
  // Cowichan Estuary Nature Centre embeds this exact Ozolio cam on
  // cowichanestuary.ca. Snapshot poster refreshes at the host's 15-min cadence.
  {
    slug: 'cowichan:heron-rookery',
    name: 'Great Blue Heron Rookery Cam (Cowichan Bay)',
    lat: 48.7405,
    lng: -123.6203,
    kind: 'snapshot',
    mediaUrl: ozolioPoster('EMB_CVMG00000101'),
    refreshSec: 900,
    attribution: 'Cowichan Estuary Nature Centre via Ozolio',
    sourceSlug: 'cowichan-heron-cam',
    check: { kind: 'image' },
  },

  // ---- orcalab-sealion-cam ----
  // Steller sea-lion haul-out on Hanson Island (Johnstone Strait / Blackfish
  // Sound). Distinct from the OrcaLab MAIN cam in extraCams. North-west of
  // VI_BBOX (see header). Live id was -uooI2satIQ ("LIVE Sea Lion Beach -
  // British Columbia | explore.org") and isLive at verify time.
  {
    slug: 'ytlive:orcalab-sealion',
    name: 'OrcaLab Sea Lion Beach Cam (Hanson Island)',
    lat: 50.5226,
    lng: -126.8389,
    kind: 'iframe',
    mediaUrl: ytEmbed('-uooI2satIQ'),
    attribution: 'explore.org / OrcaLab via YouTube',
    sourceSlug: 'orcalab-sealion-cam',
    check: { kind: 'oembed', watch: ytWatch('-uooI2satIQ') },
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
    if (cam.check.kind === 'oembed') {
      const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(cam.check.watch)}&format=json`;
      const res = await fetchSource(url, { retries: 0 });
      return res.ok ? { alive: true } : { alive: false, error: `oEmbed HTTP ${res.status}` };
    }
    if (cam.check.kind === 'ytlive') {
      // The channel /live tab serves the current live watch page when a stream
      // is on air; an off-season channel still 200s but without a live flag, so
      // we require an explicit live marker to keep dark nests active:false.
      const url = `https://www.youtube.com/channel/${cam.check.channelId}/live`;
      const res = await fetchSource(url, { retries: 0 });
      if (!res.ok) return { alive: false, error: `live tab HTTP ${res.status}` };
      const body = await res.text();
      const live = /"isLiveNow":true|"isLive":true/.test(body);
      return live ? { alive: true } : { alive: false, error: 'channel not live now' };
    }
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
      // Sequential on purpose — 7 probes once a day, several against a small
      // wildlife foundation and a volunteer nature centre we treat gently.
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
      await ctx.runMutation(internal.feeds.camsWildlife.ingest, {
        cams,
        sources: [...bySource.values()],
      });
    } catch (e) {
      await ctx.runMutation(internal.feeds.camsWildlife.fail, { error: String(e) });
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
    // Catalog edits can rename slugs across deploys — anything we own that is
    // no longer cataloged goes inactive, never deleted. (Wildlife nest cams go
    // dark off-season; the liveness check flips active without dropping rows.)
    const present = new Set(cams.map((c) => c.slug));
    const ours = new Set(Object.keys(METAS));
    const all = await ctx.db.query('cameras').collect();
    for (const row of all) {
      if (ours.has(row.sourceSlug) && row.active && !present.has(row.slug)) {
        await ctx.db.patch(row._id, { active: false });
      }
    }
    // One health row per source. Seasonal nest cams legitimately go to zero live
    // (off-season), so a source with no live cams is reported as a success with
    // count 0 rather than flagged down — these embeds are not "broken".
    for (const s of sources) {
      const meta = METAS[s.slug];
      if (!meta) continue;
      await reportSuccess(ctx, meta, s.live);
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
