import { v } from 'convex/values';
import { internalAction, internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { fetchSource } from '../lib/fetchSource';
import { reportSuccess, reportFailure, type SourceMeta } from '../lib/ingest';

// camsMarineHarbour — MARINE / HARBOUR / COASTAL cameras for the flagship CAM
// WALL, complementing extraCams (CHEK harbour lives, BC Ferries terminals,
// Mount Washington, Courtenay Airpark) and orcasound (Salish Sea hydrophones).
// Three institutionally-operated sources, one health row each; every URL was
// curl-verified 2026-06-11/12:
//
//   bamfield-msc-cams   2 ipcamlive iframes at the Bamfield Marine Sciences
//                       Centre (UVic/UBC/SFU/UAlberta/UCalgary research +
//                       teaching station, registered Canadian charity) on
//                       Trevor Channel, Barkley Sound. BMSC publicly embeds
//                       these exact player iframes on bamfieldmsc.com/webcam/.
//                       ipcamlive mints viewer-side stream tokens, so — like
//                       Courtenay's rtsp.me cam in extraCams — we iframe the
//                       sanctioned player page rather than proxy the manifest.
//   tofino-harbour-cam  1 org-curated YouTube live: Tofino Sea Kayaking's
//                       downtown Tofino harbour cam, listed as an official cam
//                       on tourismtofino.com/plan-your-trip/weather-webcams/.
//                       Stored as a watch id (oEmbed-probed); SOURCES gotcha:
//                       live ids rotate on restart — swapping a fresh id is a
//                       catalog edit, oEmbed only catches deleted/private.
//   vanisle-marina-cams 5 open JPEG snapshots from Van Isle Marina (Tsehum
//                       Harbour, Sidney), published on the marina's own live-
//                       cam page; frames refresh ~every 15 s upstream.
//
// Daily sync (86400s) re-checks liveness and flips `active` instead of dropping
// rows. Liveness probes: iframe/page embeds → GET 200; YouTube → oEmbed JSON
// 200; snapshots → GET + image/* content-type.
//
// Geography notes (bbox is VI_BBOX = lng -125.3..-123.1, lat 48.2..51.1):
//   - BMSC (48.835, -125.136) and Van Isle Marina (48.663, -123.398) sit
//     INSIDE the box.
//   - Tofino Sea Kayaking (49.153, -125.907) sits just WEST of the box edge,
//     exactly like the Tofino/Wickaninnish resort cams already hand-curated in
//     extraCams — it IS Vancouver Island, so the bbox filter is not applied to
//     this curated list.
// Worst case: 8 camera rows, 8 outbound probes per daily sync.
//
// EXCLUDED after verification (kept out on purpose, see StructuredOutput):
// Race Rocks (no current YouTube live; camera-1 is a raw http:// Canon IP-cam
// viewer — mixed-content, not embeddable), Destination Campbell River /
// Discovery Pier cams (org-operated but distributed only through SkylineWebcams
// — aggregator ToS forbids reuse), Cowichan Bay @cowbay (pub-operated, and not
// live now), Ukee Amphitrite (deprecated Nest embed, legacy-maintained by a
// private cabin business), VIU / UVic campus cams (VIUcam retired → redirects
// to DriveBC), ONC live cameras (scheduled minutes-per-hour clips behind the
// Oceans 3.0 portal, no stable public embed), Oak Bay Marina (aggregator-only,
// no first-party URL), Windy Webcams v3 (key-gated — documented below).

const CLUSTER = 'Cameras & Live Media';
const CADENCE = 86_400;

const METAS: Record<string, SourceMeta> = {
  'tofino-harbour-cam': {
    slug: 'tofino-harbour-cam',
    name: 'Tofino Harbour Cam',
    cluster: CLUSTER,
    cadenceSec: CADENCE,
    attribution: 'Tofino Sea Kayaking via YouTube (listed by Tourism Tofino)',
    licenseNote: 'YouTube ToS: playback via iframe player only — never extract HLS; live id rotates on restart',
  },
  'vanisle-marina-cams': {
    slug: 'vanisle-marina-cams',
    name: 'Van Isle Marina Cams (Sidney)',
    cluster: CLUSTER,
    cadenceSec: CADENCE,
    attribution: 'Van Isle Marina, Sidney BC',
    licenseNote: 'Marina-published JPEGs on a third-party host (bulletsecurity.ca), ToS-unreviewed — cache gently, drop on request',
  },
};

// Windy Webcams API v3 — DOCUMENTED, ENV-GATED, INTENTIONALLY NOT SEEDED.
// Unauthenticated GET 403s {"message":"Missing Header 'x-windy-api-key'..."},
// proving the v3 API is live, but a key is required to enumerate VI webcams and
// the free tier mints 10-minute image tokens (no naive caching) with mandatory
// 'Webcams provided by Windy.com' linkback + per-image hyperlinks to the
// webcam's page. No WINDY_WEBCAMS_KEY is configured, so no rows are seeded.
// When a key lands, the request shape is:
//   GET https://api.windy.com/webcams/api/v3/webcams
//       ?nearby=<lat>,<lng>,<radiusKm>&include=urls,location,images
//       header: 'x-windy-api-key: <WINDY_WEBCAMS_KEY>'
// then upsert institutionally-operated results as kind:'iframe' (webcam.player)
// with attribution 'Webcams provided by Windy.com' — reject private/backyard
// cams and anything that merely re-aggregates DriveBC.
const WINDY_WEBCAMS_KEY = process.env.WINDY_WEBCAMS_KEY;
void WINDY_WEBCAMS_KEY; // referenced so the env-gated pattern is explicit

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
const bulletJpg = (cam: string) => `https://feeds.bulletsecurity.ca/${cam}.jpg`;

// Every URL below returned the expected 200 on 2026-06-11/12 (text/html for
// ipcamlive/embed pages, oEmbed JSON for the watch id, image/jpeg for
// snapshots). Coordinates are map-marker approximations of the published cam
// locations.
const CATALOG: CatalogCam[] = [
  // (Bamfield Marine Sciences Centre cams live in camsInstitutional.ts —
  // both agents found them; institutional owns them to avoid a slug tug-of-war.)

  // ---- tofino-harbour-cam ----
  // 320 Main St, downtown Tofino waterfront — view over Tofino harbour /
  // Clayoquot Sound. oEmbed author 'Tofino Sea Kayaking (Paddle TSK)',
  // isLiveNow:true at verify time. Just west of VI_BBOX (see header note).
  {
    slug: 'ytlive:tofino-harbour',
    name: 'Tofino Harbour Cam (Tofino Sea Kayaking)',
    lat: 49.153,
    lng: -125.9067,
    kind: 'iframe',
    mediaUrl: ytEmbed('_qN4aao5kWc'),
    attribution: 'Tofino Sea Kayaking via YouTube (listed by Tourism Tofino)',
    sourceSlug: 'tofino-harbour-cam',
    check: { kind: 'oembed', watch: ytWatch('_qN4aao5kWc') },
  },

  // ---- vanisle-marina-cams ----
  // 2320 Harbour Rd, Sidney (Tsehum Harbour). Five fixed views the marina
  // publishes on its own live-cam page; upstream refresh ~15 s, but we keep
  // refreshSec conservative (60) for a busy shared host. All 200 image/jpeg
  // with fresh Last-Modified at verify time. Coordinates nudged per camera so
  // markers do not stack exactly.
  {
    slug: 'vanisle:camera05',
    name: 'Van Isle Marina Cam 5 (Tsehum Harbour, Sidney)',
    lat: 48.6632,
    lng: -123.3982,
    kind: 'snapshot',
    mediaUrl: bulletJpg('camera05'),
    refreshSec: 60,
    attribution: 'Van Isle Marina, Sidney BC',
    sourceSlug: 'vanisle-marina-cams',
    check: { kind: 'image' },
  },
  {
    slug: 'vanisle:camera13',
    name: 'Van Isle Marina Cam 13 (Tsehum Harbour, Sidney)',
    lat: 48.663,
    lng: -123.3979,
    kind: 'snapshot',
    mediaUrl: bulletJpg('camera13'),
    refreshSec: 60,
    attribution: 'Van Isle Marina, Sidney BC',
    sourceSlug: 'vanisle-marina-cams',
    check: { kind: 'image' },
  },
  {
    slug: 'vanisle:camera15',
    name: 'Van Isle Marina Cam 15 (Tsehum Harbour, Sidney)',
    lat: 48.6634,
    lng: -123.3977,
    kind: 'snapshot',
    mediaUrl: bulletJpg('camera15'),
    refreshSec: 60,
    attribution: 'Van Isle Marina, Sidney BC',
    sourceSlug: 'vanisle-marina-cams',
    check: { kind: 'image' },
  },
  {
    slug: 'vanisle:camera18',
    name: 'Van Isle Marina Cam 18 (Tsehum Harbour, Sidney)',
    lat: 48.6628,
    lng: -123.3984,
    kind: 'snapshot',
    mediaUrl: bulletJpg('camera18'),
    refreshSec: 60,
    attribution: 'Van Isle Marina, Sidney BC',
    sourceSlug: 'vanisle-marina-cams',
    check: { kind: 'image' },
  },
  {
    slug: 'vanisle:camera19',
    name: 'Van Isle Marina Cam 19 (Tsehum Harbour, Sidney)',
    lat: 48.6636,
    lng: -123.3975,
    kind: 'snapshot',
    mediaUrl: bulletJpg('camera19'),
    refreshSec: 60,
    attribution: 'Van Isle Marina, Sidney BC',
    sourceSlug: 'vanisle-marina-cams',
    check: { kind: 'image' },
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
      // Sequential on purpose — 8 probes once a day, several against small
      // institutional/volunteer hosts we promised to treat gently.
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
      await ctx.runMutation(internal.feeds.camsMarineHarbour.ingest, {
        cams,
        sources: [...bySource.values()],
      });
    } catch (e) {
      await ctx.runMutation(internal.feeds.camsMarineHarbour.fail, { error: String(e) });
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
