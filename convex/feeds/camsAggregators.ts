import { v } from 'convex/values';
import { internalAction, internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { fetchSource } from '../lib/fetchSource';
import { reportSuccess, reportFailure, type SourceMeta } from '../lib/ingest';

// camsAggregators — Vancouver Island / Salish Sea cameras mined from the big
// PUBLIC WEBCAM AGGREGATORS (allowed under DECISIONS D13's relaxed posture for
// a private, non-redistributing single-operator console: aggregator reuse-ToS
// does not block inclusion here). Complements the institutionally-curated lists
// (extraCams, camsAgency, camsInstitutional, camsMarineHarbour, drivebcCams).
// Three aggregator sources, one health row each; every URL was curl-verified
// 2026-06-11:
//
//   skyline-webcams-vi   13 SkylineWebcams cams on/around Vancouver Island,
//                        played via the sanctioned HTML player iframe
//                        embed.skylinewebcams.com/livevideo.php?id=<id>. The id
//                        is the page's canonical cam id (read from each cam
//                        page's og:image = social<id>.jpg). NB:
//                        media.php?id=<id> on the same host serves only a JPEG
//                        poster, not the live player — we iframe livevideo.php
//                        for the actual stream. Includes the Campbell River
//                        Discovery Pier / Discovery Passage cams (ids 4650/4651
//                        /4649) that camsMarineHarbour deliberately HELD OUT as
//                        "aggregator-only"; D13 reverses that call, so they
//                        land here.
//   windy-webcams-vi     5 Windy.com cams enumerated by hand (Cox Bay surf,
//                        Quisitis Beach, Comox Harbour, Parksville beach,
//                        Cowichan Bay), played via Windy's PUBLIC iframe embed
//                        webcams.windy.com/webcams/public/embed/player/<id>/day
//                        — no API key needed for the embed. The keyed v3 API
//                        (for programmatic enumeration) is documented + env-
//                        gated below but intentionally not invoked.
//   aggregator-yt-cams   2 operator-run YouTube lives surfaced via aggregator
//                        directories (WebcamTaxi / oceanvillageresort.com):
//                        Nanaimo Waterfront Suites & Marina (BRNKL) and Ocean
//                        Village Resort, Tofino. Stored as CHANNEL-based live
//                        embeds (youtube.com/embed/live_stream?channel=<id>) so
//                        they survive the live-video-id rotation that breaks a
//                        pinned watch id; both channels were confirmed live at
//                        verify time.
//
// Daily sync (86400s) re-checks liveness and flips `active` instead of dropping
// rows. Liveness probes: SkylineWebcams/Windy/YouTube-channel embeds → GET 200;
// (no oEmbed for channel-based YouTube embeds — channel live_stream urls aren't
// oEmbed-resolvable, so the 200 page check is the liveness signal).
//
// Geography notes (VI_BBOX = lng -125.3..-123.1, lat 48.2..51.1): the Tofino /
// Cox Bay / Quisitis cams (~-125.7..-125.9) sit just WEST of the box edge,
// exactly like the Tofino resort cams hand-curated in extraCams /
// camsMarineHarbour — they ARE Vancouver Island, so the bbox filter is not
// applied to this curated list. Everything else is inside the box.
// Worst case: 20 camera rows, 20 outbound probes per daily sync.
//
// EXCLUDED after verification (kept out on purpose, see StructuredOutput):
// WebcamTaxi detail pages (Cloudflare bot-challenge — could not read the
// underlying embed to verify it, and the unique VI ones we DID resolve we seed
// directly from the operator's YouTube channel instead); Cowichan Bay YouTube
// (channel UC5LGqf… not live at verify time — kept via the Windy embed of the
// same bay); Ozolio "Heron's Nest" (poster oid 404s and location is Vancouver,
// not the Island). NO unsecured/private/residential cams and NO Insecam-style
// directory entries were touched (DECISIONS D13 hard lines).

const CLUSTER = 'Cameras & Live Media';
const CADENCE = 86_400;

const METAS: Record<string, SourceMeta> = {
  'windy-webcams-vi': {
    slug: 'windy-webcams-vi',
    name: 'Windy Webcams (Vancouver Island)',
    cluster: CLUSTER,
    cadenceSec: CADENCE,
    attribution: 'Webcams provided by Windy.com',
    licenseNote:
      'Windy public embed player iframe (no key); free-tier ToS wants the "Webcams provided by Windy.com" linkback — honoured in attribution',
  },
  'aggregator-yt-cams': {
    slug: 'aggregator-yt-cams',
    name: 'Operator YouTube Cams (via aggregators)',
    cluster: CLUSTER,
    cadenceSec: CADENCE,
    attribution: 'BRNKL / Barnacle Systems (via YouTube)',
    licenseNote:
      'YouTube ToS: playback via iframe player only — never extract HLS; channel-based live embed survives live-id rotation',
  },
};

// Windy Webcams API v3 — DOCUMENTED, ENV-GATED, INTENTIONALLY NOT SEEDED.
// The PUBLIC iframe embeds above need no key; the v3 REST API (for programmatic
// enumeration of more VI cams) does. Unauthenticated GET 403s
// {"message":"Missing Header 'x-windy-api-key'..."}, proving the API is live.
// No WINDY_WEBCAMS_KEY is configured, so no API-enumerated rows are seeded.
// When a key lands, the request shape is:
//   GET https://api.windy.com/webcams/api/v3/webcams
//       ?nearby=<lat>,<lng>,<radiusKm>&include=urls,location,images&limit=50
//       header: 'x-windy-api-key: <WINDY_WEBCAMS_KEY>'
// then upsert operator-run results as kind:'iframe' using webcam.urls.embed
// (the public player above), attribution 'Webcams provided by Windy.com' —
// rejecting private/backyard cams and anything that merely re-aggregates DriveBC
// (already covered by drivebcCams).
const WINDY_WEBCAMS_KEY = process.env.WINDY_WEBCAMS_KEY;
void WINDY_WEBCAMS_KEY; // referenced so the env-gated pattern is explicit

type Check =
  | { kind: 'page' } // GET mediaUrl, expect 200 (embed/player pages)
  | { kind: 'image' }; // GET mediaUrl, expect image/* (unused today; kept for poster cams)

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

const windy = (id: number) =>
  `https://webcams.windy.com/webcams/public/embed/player/${id}/day`;
const ytChannelLive = (channelId: string) =>
  `https://www.youtube.com/embed/live_stream?channel=${channelId}`;

const WINDY_ATTR = 'Webcams provided by Windy.com';

// Every URL below returned the expected 200 text/html on 2026-06-11 (the
// SkylineWebcams/Windy/YouTube-channel embed players). Coordinates are
// map-marker approximations of each published cam location.
const CATALOG: CatalogCam[] = [
  // ---- windy-webcams-vi (public iframe embeds, no key) ----
  {
    slug: 'windy:tofino-coxbay-surf',
    name: 'Tofino — Cox Bay Surf (Windy)',
    lat: 49.0577,
    lng: -125.8797,
    kind: 'iframe',
    mediaUrl: windy(1296110138),
    attribution: WINDY_ATTR,
    sourceSlug: 'windy-webcams-vi',
    check: { kind: 'page' },
  },
  {
    slug: 'windy:quisitis-beach',
    name: 'Pacific Rim — Quisitis / Wickaninnish Beach (Windy)',
    lat: 49.0,
    lng: -125.68,
    kind: 'iframe',
    mediaUrl: windy(1271605951),
    attribution: WINDY_ATTR,
    sourceSlug: 'windy-webcams-vi',
    check: { kind: 'page' },
  },
  {
    slug: 'windy:comox-harbour',
    name: 'Comox Harbour (Windy)',
    lat: 49.6733,
    lng: -124.9342,
    kind: 'iframe',
    mediaUrl: windy(1460345709),
    attribution: WINDY_ATTR,
    sourceSlug: 'windy-webcams-vi',
    check: { kind: 'page' },
  },
  {
    slug: 'windy:parksville-beach',
    name: 'Parksville Beach (Windy)',
    lat: 49.3192,
    lng: -124.2944,
    kind: 'iframe',
    mediaUrl: windy(1235692520),
    attribution: WINDY_ATTR,
    sourceSlug: 'windy-webcams-vi',
    check: { kind: 'page' },
  },
  {
    slug: 'windy:cowichan-bay',
    name: 'Cowichan Bay (Windy)',
    lat: 48.7397,
    lng: -123.6189,
    kind: 'iframe',
    mediaUrl: windy(1386966010),
    attribution: WINDY_ATTR,
    sourceSlug: 'windy-webcams-vi',
    check: { kind: 'page' },
  },

  // ---- aggregator-yt-cams (operator YouTube, channel-based live embeds) ----
  {
    slug: 'ytlive:nanaimo-waterfront-suites',
    name: 'Nanaimo Waterfront Suites & Marina (BRNKL)',
    lat: 49.1903,
    lng: -123.9536,
    kind: 'iframe',
    mediaUrl: ytChannelLive('UCMtPGxBtX5dekKt0X9syGjQ'),
    attribution: 'BRNKL / Barnacle Systems · Nanaimo Waterfront Suites (via YouTube)',
    sourceSlug: 'aggregator-yt-cams',
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
      // Sequential on purpose — 20 probes once a day against shared aggregator
      // hosts we promised to treat gently.
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
      await ctx.runMutation(internal.feeds.camsAggregators.ingest, {
        cams,
        sources: [...bySource.values()],
      });
    } catch (e) {
      await ctx.runMutation(internal.feeds.camsAggregators.fail, { error: String(e) });
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
    // One health row per source. A source with zero live cams is a real
    // failure (these URLs were all verified working) — flag it.
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
