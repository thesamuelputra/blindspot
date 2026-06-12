import { v } from 'convex/values';
import { internalAction, internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { fetchSource } from '../lib/fetchSource';
import { reportSuccess, reportFailure, type SourceMeta } from '../lib/ingest';

// camsTourism — TOURISM / BUSINESS / RESORT / COMMUNITY operator webcams for the
// flagship CAM WALL, complementing the institutional/agency/marine cam modules.
// Under DECISIONS D13 (relaxed posture for a private, non-redistributing single-
// operator console) publicly-broadcast tourism/business cams are seedable even
// when distributed through an aggregator. Two sources, one health row each;
// every URL was curl-verified 2026-06-11.
//
//   skyline-vi-cams      14 Vancouver Island SkylineWebcams snapshots. Skyline
//                        exposes a first-party live JPEG per cam at
//                        embed.skylinewebcams.com/media.php?id=<id> (200
//                        image/jpeg, Last-Modified at the current minute → the
//                        feed refreshes ~1/min, so refreshSec 60). We render
//                        the refreshing JPEG (kind:'snapshot'), NOT the HLS the
//                        Skyline player streams. These are operator/tourism cams
//                        Skyline redistributes (Destination Campbell River's
//                        Discovery Pier set, Tigh-Na-Mara at Craig Bay, Victoria
//                        Inner Harbour, Nanaimo & Port Alberni waterfronts,
//                        Campbell River Airport, Tofino beaches, Ross Bay) —
//                        aggregator reuse-ToS does not block a private console.
//   tofino-resort-cams   2 resort-operated YouTube lives (iframe player):
//                        Ocean Village Resort (Mackenzie Beach) and Crystal Cove
//                        Beach Resort (Crystal Cove), both listed as official
//                        cams on tourismtofino.com/plan-your-trip/weather-webcams/.
//                        Stored as watch ids (oEmbed-probed). SOURCES gotcha:
//                        live video ids ROTATE on stream restart — swapping a
//                        fresh id is a catalog edit; oEmbed only catches a
//                        deleted/private video.
//
// Daily sync (86400s) re-checks liveness and flips `active` instead of dropping
// rows. Liveness probes: snapshots → GET + image/* content-type; YouTube →
// oEmbed JSON 200.
//
// Geography (VI_BBOX = lng -125.3..-123.1, lat 48.2..51.1): all Skyline cams sit
// INSIDE the box. The two Tofino resort YouTube cams (~49.10/-125.88) sit just
// WEST of the box edge, exactly like the Tofino/Wickaninnish resort cams already
// hand-curated in extraCams/camsInstitutional — they ARE Vancouver Island, so the
// bbox filter is not applied to this curated list.
// Worst case: 16 camera rows, 16 outbound probes per daily sync.
//
// EXCLUDED after verification (kept out on purpose, see StructuredOutput):
//   - Tin Wis Resort YouTube cam (id tTIhAzpykqE, listed by Tourism Tofino):
//     oEmbed 401 Unauthorized — the video is private/removed, not seedable now.
//   - Cowichan Bay Live Webcam (YouTube channel UC5LGqf11G_gj6MRdFRnwsyg):
//     dedicated operator webcam channel but NOT live-broadcasting at verify time
//     (/live canonical points back to the channel, embed playabilityStatus is
//     offline) — would render an offline placeholder, so held until live.
//   - Long Beach Lodge (84dLnpdqC_U) / Wickaninnish (kt0zTvkyfoM) / Pacific Sands
//     (LqaP8m2OIqM) YouTube cams aggregated on longbeachsurfshop.com: these are
//     the SAME cams already seeded in camsInstitutional/extraCams — skipped to
//     avoid duplicate camera rows.
//   - Skyline Tofino beach cams overlap conceptually with the resort beach cams
//     in extraCams/camsInstitutional, but they are DISTINCT Skyline camera feeds
//     (different operators/vantage) at separate slugs, so they are kept.
//   - Mount Washington webcams.html exposes only the two Ozolio cams already in
//     extraCams (EMB_SKAO00000241, EMB_ONTI0000039F) — nothing new there.

const CLUSTER = 'Cameras & Live Media';
const CADENCE = 86_400;

const METAS: Record<string, SourceMeta> = {
  'skyline-vi-cams': {
    slug: 'skyline-vi-cams',
    name: 'SkylineWebcams Vancouver Island Cams',
    cluster: CLUSTER,
    cadenceSec: CADENCE,
    attribution: 'Tourism/business operators via SkylineWebcams',
    licenseNote:
      'Aggregator-distributed operator cams; first-party live JPEG hotlinked (media.php?id=) — private console only, never redistributed, drop on request',
  },
  'tofino-resort-cams': {
    slug: 'tofino-resort-cams',
    name: 'Tofino Resort Cams',
    cluster: CLUSTER,
    cadenceSec: CADENCE,
    attribution: 'Ocean Village Resort · Crystal Cove Beach Resort (via YouTube)',
    licenseNote:
      'YouTube ToS: playback via iframe player only — never extract HLS; live id rotates on restart',
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
// Skyline's first-party live snapshot endpoint. media.php?id=<id> returned 200
// image/jpeg with a current-minute Last-Modified for every id below on
// 2026-06-11, so the frame is genuinely live and refreshSec 60 matches upstream.
const skyJpg = (id: number) => `https://embed.skylinewebcams.com/media.php?id=${id}`;

// Every URL below returned the expected 200 on 2026-06-11 (image/jpeg for Skyline
// snapshots, oEmbed JSON for the watch ids; both YouTube ids were isLiveNow:true
// at verify time). Coordinates are map-marker approximations of the published cam
// locations; nudged per camera where several share one site so markers don't stack.
const CATALOG: CatalogCam[] = [
  // ---- skyline-vi-cams ----
  // Campbell River — Destination Campbell River's three Discovery Pier /
  // Discovery Passage waterfront cams (campbellriver.travel lists them).
  {
    slug: 'skyline:cr-discovery-pier',
    name: 'Campbell River — Discovery Pier',
    lat: 50.0334,
    lng: -125.2442,
    kind: 'snapshot',
    mediaUrl: skyJpg(4650),
    refreshSec: 60,
    attribution: 'Destination Campbell River via SkylineWebcams',
    sourceSlug: 'skyline-vi-cams',
    check: { kind: 'image' },
  },
  {
    slug: 'skyline:cr-discovery-passage',
    name: 'Campbell River — Discovery Passage',
    lat: 50.0329,
    lng: -125.2451,
    kind: 'snapshot',
    mediaUrl: skyJpg(4651),
    refreshSec: 60,
    attribution: 'Destination Campbell River via SkylineWebcams',
    sourceSlug: 'skyline-vi-cams',
    check: { kind: 'image' },
  },
  {
    slug: 'skyline:cr-waterfront',
    name: 'Campbell River — Waterfront',
    lat: 50.0252,
    lng: -125.2436,
    kind: 'snapshot',
    mediaUrl: skyJpg(4649),
    refreshSec: 60,
    attribution: 'Destination Campbell River via SkylineWebcams',
    sourceSlug: 'skyline-vi-cams',
    check: { kind: 'image' },
  },
  // Campbell River Airport (YBL) — apron + runway views.
  {
    slug: 'skyline:cr-airport',
    name: 'Campbell River Airport (YBL)',
    lat: 49.9508,
    lng: -125.2719,
    kind: 'snapshot',
    mediaUrl: skyJpg(5779),
    refreshSec: 60,
    attribution: 'Campbell River Airport via SkylineWebcams',
    sourceSlug: 'skyline-vi-cams',
    check: { kind: 'image' },
  },
  {
    slug: 'skyline:cr-airport-runway',
    name: 'Campbell River Airport — Runway',
    lat: 49.9502,
    lng: -125.2735,
    kind: 'snapshot',
    mediaUrl: skyJpg(5780),
    refreshSec: 60,
    attribution: 'Campbell River Airport via SkylineWebcams',
    sourceSlug: 'skyline-vi-cams',
    check: { kind: 'image' },
  },
  // Parksville — Tigh-Na-Mara Seaside Spa Resort, Craig Bay.
  {
    slug: 'skyline:parksville-craigbay',
    name: 'Parksville — Craig Bay (Tigh-Na-Mara)',
    lat: 49.3157,
    lng: -124.2872,
    kind: 'snapshot',
    mediaUrl: skyJpg(3232),
    refreshSec: 60,
    attribution: 'Tigh-Na-Mara Seaside Spa Resort via SkylineWebcams',
    sourceSlug: 'skyline-vi-cams',
    check: { kind: 'image' },
  },
  // Nanaimo waterfront.
  {
    slug: 'skyline:nanaimo-waterfront',
    name: 'Nanaimo — Waterfront',
    lat: 49.166,
    lng: -123.9333,
    kind: 'snapshot',
    mediaUrl: skyJpg(3808),
    refreshSec: 60,
    attribution: 'Nanaimo waterfront via SkylineWebcams',
    sourceSlug: 'skyline-vi-cams',
    check: { kind: 'image' },
  },
  // Port Alberni — Harbour Quay.
  {
    slug: 'skyline:port-alberni-quay',
    name: 'Port Alberni — Harbour Quay',
    lat: 49.2331,
    lng: -124.8138,
    kind: 'snapshot',
    mediaUrl: skyJpg(3825),
    refreshSec: 60,
    attribution: 'Port Alberni via SkylineWebcams',
    sourceSlug: 'skyline-vi-cams',
    check: { kind: 'image' },
  },
  // Victoria — Inner Harbour (two distinct Skyline feeds) + Ross Bay.
  {
    slug: 'skyline:victoria-harbour',
    name: 'Victoria — Inner Harbour',
    lat: 48.4226,
    lng: -123.3702,
    kind: 'snapshot',
    mediaUrl: skyJpg(3752),
    refreshSec: 60,
    attribution: 'Victoria Inner Harbour via SkylineWebcams',
    sourceSlug: 'skyline-vi-cams',
    check: { kind: 'image' },
  },
  {
    slug: 'skyline:victoria-causeway',
    name: 'Victoria — Inner Harbour Causeway',
    lat: 48.4222,
    lng: -123.3695,
    kind: 'snapshot',
    mediaUrl: skyJpg(3705),
    refreshSec: 60,
    attribution: 'Victoria Inner Harbour via SkylineWebcams',
    sourceSlug: 'skyline-vi-cams',
    check: { kind: 'image' },
  },
  {
    slug: 'skyline:victoria-rossbay',
    name: 'Victoria — Ross Bay',
    lat: 48.4115,
    lng: -123.3468,
    kind: 'snapshot',
    mediaUrl: skyJpg(3977),
    refreshSec: 60,
    attribution: 'Ross Bay, Victoria via SkylineWebcams',
    sourceSlug: 'skyline-vi-cams',
    check: { kind: 'image' },
  },
  // Tofino — three distinct Skyline beach feeds (separate from the resort cams
  // in extraCams/camsInstitutional). Just west of VI_BBOX (see header note).
  {
    slug: 'skyline:tofino-chesterman',
    name: 'Tofino — Chesterman Beach (SkylineWebcams)',
    lat: 49.131,
    lng: -125.8925,
    kind: 'snapshot',
    mediaUrl: skyJpg(3341),
    refreshSec: 60,
    attribution: 'Tofino Chesterman Beach via SkylineWebcams',
    sourceSlug: 'skyline-vi-cams',
    check: { kind: 'image' },
  },
  {
    slug: 'skyline:tofino-crystalcove',
    name: 'Tofino — Crystal Cove Beach (SkylineWebcams)',
    lat: 49.1218,
    lng: -125.8862,
    kind: 'snapshot',
    mediaUrl: skyJpg(3340),
    refreshSec: 60,
    attribution: 'Tofino Crystal Cove Beach via SkylineWebcams',
    sourceSlug: 'skyline-vi-cams',
    check: { kind: 'image' },
  },
  {
    slug: 'skyline:tofino-longbeach',
    name: 'Tofino — Long Beach (SkylineWebcams)',
    lat: 49.0735,
    lng: -125.772,
    kind: 'snapshot',
    mediaUrl: skyJpg(2402),
    refreshSec: 60,
    attribution: 'Pacific Rim / Long Beach via SkylineWebcams',
    sourceSlug: 'skyline-vi-cams',
    check: { kind: 'image' },
  },

  // ---- tofino-resort-cams ----
  // Ocean Village Resort — Mackenzie Beach. oEmbed author 'Ocean Village Resort
  // Tofino', isLiveNow:true at verify time. Just west of VI_BBOX.
  {
    slug: 'ytlive:oceanvillage-mackenzie',
    name: 'Ocean Village Resort — Mackenzie Beach (Tofino)',
    lat: 49.1318,
    lng: -125.9082,
    kind: 'iframe',
    mediaUrl: ytEmbed('5WdsHkKVanA'),
    attribution: 'Ocean Village Resort via YouTube (listed by Tourism Tofino)',
    sourceSlug: 'tofino-resort-cams',
    check: { kind: 'oembed', watch: ytWatch('5WdsHkKVanA') },
  },
  // Crystal Cove Beach Resort — Crystal Cove (Mackenzie Beach). oEmbed author
  // 'Crystal Cove Beach Resort', isLiveNow:true at verify time.
  {
    slug: 'ytlive:crystalcove-tofino',
    name: 'Crystal Cove Beach Resort — Crystal Cove (Tofino)',
    lat: 49.1228,
    lng: -125.9035,
    kind: 'iframe',
    mediaUrl: ytEmbed('AovvFApVnKc'),
    attribution: 'Crystal Cove Beach Resort via YouTube (listed by Tourism Tofino)',
    sourceSlug: 'tofino-resort-cams',
    check: { kind: 'oembed', watch: ytWatch('AovvFApVnKc') },
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
      // Sequential on purpose — 16 probes once a day against a shared aggregator
      // host and YouTube; no reason to burst.
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
      await ctx.runMutation(internal.feeds.camsTourism.ingest, {
        cams,
        sources: [...bySource.values()],
      });
    } catch (e) {
      await ctx.runMutation(internal.feeds.camsTourism.fail, { error: String(e) });
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
    // no longer cataloged goes inactive, never deleted.
    const present = new Set(cams.map((c) => c.slug));
    const ours = new Set(Object.keys(METAS));
    const all = await ctx.db.query('cameras').collect();
    for (const row of all) {
      if (ours.has(row.sourceSlug) && row.active && !present.has(row.slug)) {
        await ctx.db.patch(row._id, { active: false });
      }
    }
    // One health row per source. A source with zero live cams is a real failure
    // (these URLs were all verified working) — flag it.
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
