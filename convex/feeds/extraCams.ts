import { v } from 'convex/values';
import { internalAction, internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { fetchSource } from '../lib/fetchSource';
import { reportSuccess, reportFailure, type SourceMeta } from '../lib/ingest';

// extraCams — curated camera seeds for FOUR SOURCES.md entries in the
// Cameras & Live Media cluster, one health row each:
//   youtube-live-vi          6 org-run YouTube lives (iframe embeds)
//   public-jpeg-cams         Mount Washington (Ozolio) + UVic mesh webcam
//   bc-ferries-terminal-cams 6 VI terminal-condition JPEGs
//   courtenay-airpark-cam    1 rtsp.me iframe (Comox Valley)
//
// The catalog is static (every URL curl-verified 2026-06-11); the daily sync
// re-verifies liveness and flips `active` instead of dropping rows:
//   - YouTube watch IDs → oEmbed probe (200 = exists + embeddable). SOURCES
//     gotcha: live video IDs ROTATE on stream restart and oEmbed still 200s
//     for the leftover archive, so this catches deleted/private videos only;
//     swapping in fresh IDs stays a catalog edit.
//   - Snapshot JPEGs → GET, require ok + image/* content-type.
//   - Channel-based / rtsp.me embeds → GET page, require 200.
// Several cams sit deliberately OUTSIDE VI_BBOX's west edge (-125.3): the
// Tofino pair (~-125.87), Wickaninnish (~-125.89), Mount Washington
// (~-125.29/-125.30 ridge) and OrcaLab on Hanson Island (~-126.7). SOURCES
// is explicit they ARE Vancouver Island / VI waters — the bbox filter is
// intentionally not applied to this hand-curated list.
// Worst case: 16 camera rows, 16 outbound probes per daily sync.

const CLUSTER = 'Cameras & Live Media';
const CADENCE = 86_400;

const METAS: Record<string, SourceMeta> = {
  'youtube-live-vi': {
    slug: 'youtube-live-vi',
    name: 'YouTube Live Cams (VI orgs)',
    cluster: CLUSTER,
    cadenceSec: CADENCE,
    attribution: 'CHEK Media · Pacific Sands · Wickaninnish Inn · explore.org/OrcaLab (via YouTube)',
    licenseNote: 'YouTube ToS: playback via iframe player only — never extract HLS',
  },
  'public-jpeg-cams': {
    slug: 'public-jpeg-cams',
    name: 'Institutional Snapshot Cams',
    cluster: CLUSTER,
    cadenceSec: CADENCE,
    attribution: 'Mount Washington Alpine Resort · victoriaweather.ca (UVic)',
    licenseNote: 'Tolerated hotlinks, not formally licensed — cache gently, be ready to drop on request',
  },
  'bc-ferries-terminal-cams': {
    slug: 'bc-ferries-terminal-cams',
    name: 'BC Ferries Terminal Cams',
    cluster: CLUSTER,
    cadenceSec: CADENCE,
    attribution: 'BC Ferries',
    licenseNote: 'Unofficial-but-public production API, no published ToS — low volume, may vanish',
  },
  'courtenay-airpark-cam': {
    slug: 'courtenay-airpark-cam',
    name: 'Courtenay Airpark Webcam',
    cluster: CLUSTER,
    cadenceSec: CADENCE,
    attribution: 'Courtenay Airpark Association',
    licenseNote: 'rtsp.me HLS tokens are viewer-IP-bound — iframe the embed, never proxy the manifest',
  },
};

type Check =
  | { kind: 'oembed'; watch: string } // YouTube watch URL → oEmbed JSON probe
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

const ytEmbed = (id: string) => `https://www.youtube.com/embed/${id}`;
const ytWatch = (id: string) => `https://www.youtube.com/watch?v=${id}`;

// Every URL below returned the expected 200 (image/jpeg for snapshots, oEmbed
// JSON for watch IDs, text/html for embed pages) on 2026-06-11. Coordinates
// are map-marker approximations of the published cam locations.
const CATALOG: CatalogCam[] = [
  // ---- youtube-live-vi ----
  {
    slug: 'ytlive:chek-victoria',
    name: 'CHEK Victoria Harbour Cam (Ships Point)',
    lat: 48.4226,
    lng: -123.3702,
    kind: 'iframe',
    mediaUrl: ytEmbed('ZvqDwjNoN7Y'),
    attribution: 'CHEK Media via YouTube',
    sourceSlug: 'youtube-live-vi',
    check: { kind: 'oembed', watch: ytWatch('ZvqDwjNoN7Y') },
  },
  {
    slug: 'ytlive:chek-nanaimo',
    name: 'CHEK Nanaimo Harbour Cam (Port Theatre)',
    lat: 49.1665,
    lng: -123.936,
    kind: 'iframe',
    mediaUrl: ytEmbed('qU7gQ5Aj2gY'),
    attribution: 'CHEK Media via YouTube',
    sourceSlug: 'youtube-live-vi',
    check: { kind: 'oembed', watch: ytWatch('qU7gQ5Aj2gY') },
  },
  {
    slug: 'ytlive:pacificsands-coxbay',
    name: 'Pacific Sands Cox Bay Surf Cam (Tofino)',
    lat: 49.1046,
    lng: -125.8755,
    kind: 'iframe',
    mediaUrl: ytEmbed('LqaP8m2OIqM'),
    attribution: 'Pacific Sands Beach Resort via YouTube',
    sourceSlug: 'youtube-live-vi',
    check: { kind: 'oembed', watch: ytWatch('LqaP8m2OIqM') },
  },
  {
    slug: 'ytlive:pacificsands-hd',
    name: 'Pacific Sands HD Beach Cam (Tofino)',
    lat: 49.106,
    lng: -125.873,
    kind: 'iframe',
    mediaUrl: ytEmbed('g2HGBY2v-wo'),
    attribution: 'Pacific Sands Beach Resort via YouTube',
    sourceSlug: 'youtube-live-vi',
    check: { kind: 'oembed', watch: ytWatch('g2HGBY2v-wo') },
  },
  {
    // Stable channel-based live embed (survives video-ID rotation) — the
    // pattern SOURCES verified for this channel specifically.
    slug: 'ytlive:wickaninnish-chesterman',
    name: 'Wickaninnish Inn Chesterman Beach Cam',
    lat: 49.13,
    lng: -125.893,
    kind: 'iframe',
    mediaUrl: 'https://www.youtube.com/embed/live_stream?channel=UCW1DIPA5POQZ1Jh1x_vl_uQ',
    attribution: 'Wickaninnish Inn via YouTube',
    sourceSlug: 'youtube-live-vi',
    check: { kind: 'page' },
  },
  {
    slug: 'ytlive:orcalab-hanson',
    name: 'OrcaLab Main Cams (Hanson Island / Johnstone Strait)',
    lat: 50.574,
    lng: -126.706,
    kind: 'iframe',
    mediaUrl: ytEmbed('hTOmWcmr2Tc'),
    attribution: 'explore.org / OrcaLab via YouTube',
    sourceSlug: 'youtube-live-vi',
    check: { kind: 'oembed', watch: ytWatch('hTOmWcmr2Tc') },
  },

  // ---- public-jpeg-cams ----
  // Ozolio poster API: cache-control max-age=900 → refreshSec 900, no faster.
  {
    slug: 'mtwash:nordic',
    name: 'Mount Washington Nordic (Raven Lodge)',
    lat: 49.7365,
    lng: -125.2885,
    kind: 'snapshot',
    mediaUrl: 'https://relay.ozolio.com/pub.api?cmd=poster&oid=EMB_ONTI0000039F',
    refreshSec: 900,
    attribution: 'Mount Washington Alpine Resort',
    sourceSlug: 'public-jpeg-cams',
    check: { kind: 'image' },
  },
  {
    slug: 'mtwash:cam2',
    name: 'Mount Washington Resort Cam 2',
    lat: 49.742,
    lng: -125.29,
    kind: 'snapshot',
    mediaUrl: 'https://relay.ozolio.com/pub.api?cmd=poster&oid=EMB_SKAO00000241',
    refreshSec: 900,
    attribution: 'Mount Washington Alpine Resort',
    sourceSlug: 'public-jpeg-cams',
    check: { kind: 'image' },
  },
  // UVic weather-mesh per-station webcams: the documented pattern is
  // /stations/<slug>/cam/latest.jpg, but a sweep of all 13 curated mesh
  // stations PLUS the full greater-Victoria / Nanaimo / Duncan region lists
  // (~34 station slugs) found exactly ONE working cam: UVicSci (200
  // image/jpeg, Last-Modified seconds old). Everything else 404s — seed just
  // the one; add slugs here if more cams appear.
  {
    slug: 'uviccam:UVicSci',
    name: 'UVic Science Building Webcam',
    lat: 48.4623, // from the station's current.xml (longitude 236.691°E → -123.309)
    lng: -123.309,
    kind: 'snapshot',
    mediaUrl: 'https://www.victoriaweather.ca/stations/UVicSci/cam/latest.jpg',
    refreshSec: 60,
    attribution: 'Vancouver Island School-Based Weather Station Network · victoriaweather.ca',
    sourceSlug: 'public-jpeg-cams',
    check: { kind: 'image' },
  },

  // ---- bc-ferries-terminal-cams ----
  // 320x180 thumbs refreshed ~1/min upstream; refreshSec 180 keeps us in the
  // entry's conservative 2-5 min lane. Terminal code 'duk' IS lowercase.
  {
    slug: 'bcferries:cam1_SWB',
    name: 'Swartz Bay Terminal Cam 1',
    lat: 48.6889,
    lng: -123.4109,
    kind: 'snapshot',
    mediaUrl: 'https://apigateway.bcferries.com/api/currentconditions/1.0/images/terminals/cam1_SWB.jpg',
    refreshSec: 180,
    attribution: 'BC Ferries',
    sourceSlug: 'bc-ferries-terminal-cams',
    check: { kind: 'image' },
  },
  {
    slug: 'bcferries:cam2_SWB',
    name: 'Swartz Bay Terminal Cam 2',
    lat: 48.6883,
    lng: -123.4099,
    kind: 'snapshot',
    mediaUrl: 'https://apigateway.bcferries.com/api/currentconditions/1.0/images/terminals/cam2_SWB.jpg',
    refreshSec: 180,
    attribution: 'BC Ferries',
    sourceSlug: 'bc-ferries-terminal-cams',
    check: { kind: 'image' },
  },
  {
    slug: 'bcferries:cam1_NAN',
    name: 'Departure Bay Terminal Cam 1',
    lat: 49.1936,
    lng: -123.9554,
    kind: 'snapshot',
    mediaUrl: 'https://apigateway.bcferries.com/api/currentconditions/1.0/images/terminals/cam1_NAN.jpg',
    refreshSec: 180,
    attribution: 'BC Ferries',
    sourceSlug: 'bc-ferries-terminal-cams',
    check: { kind: 'image' },
  },
  {
    slug: 'bcferries:cam2_NAN',
    name: 'Departure Bay Terminal Cam 2',
    lat: 49.193,
    lng: -123.9546,
    kind: 'snapshot',
    mediaUrl: 'https://apigateway.bcferries.com/api/currentconditions/1.0/images/terminals/cam2_NAN.jpg',
    refreshSec: 180,
    attribution: 'BC Ferries',
    sourceSlug: 'bc-ferries-terminal-cams',
    check: { kind: 'image' },
  },
  {
    slug: 'bcferries:cam1_duk',
    name: 'Duke Point Terminal Cam 1',
    lat: 49.1626,
    lng: -123.8908,
    kind: 'snapshot',
    mediaUrl: 'https://apigateway.bcferries.com/api/currentconditions/1.0/images/terminals/cam1_duk.jpg',
    refreshSec: 180,
    attribution: 'BC Ferries',
    sourceSlug: 'bc-ferries-terminal-cams',
    check: { kind: 'image' },
  },
  {
    slug: 'bcferries:cam2_duk',
    name: 'Duke Point Terminal Cam 2',
    lat: 49.162,
    lng: -123.89,
    kind: 'snapshot',
    mediaUrl: 'https://apigateway.bcferries.com/api/currentconditions/1.0/images/terminals/cam2_duk.jpg',
    refreshSec: 180,
    attribution: 'BC Ferries',
    sourceSlug: 'bc-ferries-terminal-cams',
    check: { kind: 'image' },
  },

  // ---- courtenay-airpark-cam ----
  // Open HLS exists but manifests are signed per viewer IP — a Convex-minted
  // URL will not play in the browser, so we iframe the rtsp.me embed page
  // (also the most clearly sanctioned use; the association embeds it
  // themselves on courtenayairpark.com/Webcams).
  {
    slug: 'airpark:courtenay',
    name: 'Courtenay Airpark Webcam (Comox Valley)',
    lat: 49.68,
    lng: -124.981,
    kind: 'iframe',
    mediaUrl: 'https://rtsp.me/embed/rZZTZdsN/',
    attribution: 'Courtenay Airpark Association',
    sourceSlug: 'courtenay-airpark-cam',
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
    if (cam.check.kind === 'oembed') {
      const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(cam.check.watch)}&format=json`;
      const res = await fetchSource(url, { retries: 0 });
      return res.ok ? { alive: true } : { alive: false, error: `oEmbed HTTP ${res.status}` };
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
      // Sequential on purpose — 16 probes once a day, several against small
      // volunteer/production hosts we promised to treat gently.
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
      await ctx.runMutation(internal.feeds.extraCams.ingest, {
        cams,
        sources: [...bySource.values()],
      });
    } catch (e) {
      await ctx.runMutation(internal.feeds.extraCams.fail, { error: String(e) });
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
    // Catalog edits can rename slugs across deploys — anything we own that
    // is no longer cataloged goes inactive, never deleted.
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
