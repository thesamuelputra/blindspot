import { v } from 'convex/values';
import { internalAction, internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { fetchSource } from '../lib/fetchSource';
import { reportSuccess, reportFailure, type SourceMeta } from '../lib/ingest';

// camsTrails — TRAIL / RECREATION / GOLF / SHORE-STATION webcams for the CAM
// WALL, complementing the existing cam modules (DriveBC, WSDOT/WSF, BC Ferries
// terminals, Hakai, Bamfield, Mt Washington, SkylineWebcams, Windy, Hancock
// eagle cams, tourism/resort cams, Van Isle Marina, Orcasound). Under DECISIONS
// D13's relaxed posture — any publicly-broadcast cam is in; only private /
// unsecured / residential cams and encrypted radio are out — these are four
// FRESH publicly-broadcast sources nobody else seeds. Every URL was curl-
// verified 2026-06-11/12 (200 image/jpeg for snapshots, 200 oEmbed JSON for the
// YouTube ids).
//
//   victoria-golf-cams  5 hole-by-hole live cams the Victoria Golf Club (Oak
//                       Bay, the oldest golf club in Canada in its original
//                       location, est. 1893) publishes on victoriagolf.com.
//                       The club fronts these as camstreamer.com/embed links
//                       that 302 straight to plain YouTube live ids — so we
//                       store the canonical watch id (oEmbed-probed) and serve
//                       the youtube /embed iframe, exactly the YouTube pattern
//                       the marine/tourism modules already use. SOURCES gotcha:
//                       live ids rotate on restart; swapping a fresh id is a
//                       catalog edit, oEmbed only catches deleted/private.
//   patbay-webcam       1 open JPEG from patbaywebcam.com — a dedicated public
//                       weather webcam looking over Patricia Bay / Saanich
//                       Inlet near Sidney (North Saanich). Purpose-built public
//                       cam on its own domain, not a residential surveillance
//                       feed. Exact mast location is unpublished, so it is
//                       placed at the Pat Bay shoreline with approxKm:3.
//   harling-point-cam   1 open JPEG from namroc.com — the Harling Point Weather
//                       Station (Gonzales / Oak Bay, Victoria), a long-running
//                       public amateur weather station that broadcasts a fixed
//                       sea-facing frame. Small known site, exact coords.
//   coastwebcams-vi     3 open JPEGs that coastwebcams.ca self-hosts (its own
//                       Reolink cameras, not a re-broadcast of a third party):
//                       Departure Bay (Nanaimo), Nanaimo Waterfront, and the
//                       Tigh-Na-Mara Seaside Spa view over the Strait of
//                       Georgia at Parksville. Frames refresh on the order of a
//                       minute upstream.
//
// Daily-ish sync (CADENCE) re-checks liveness and flips `active` instead of
// dropping rows. Liveness probes: snapshots → GET + image/* content-type;
// YouTube → oEmbed JSON 200.
//
// ESTIMATED COORDINATES (per Samuel's explicit ask): when a cam's exact mast
// location is unknown it is placed at the best site estimate and `approxKm` is
// set to the uncertainty radius in km (the map draws a range circle for those).
// Cams with exact coords leave approxKm unset.
//
// Geography (VI_BBOX = lng -125.3..-123.1, lat 48.2..51.1): every site below
// sits INSIDE the box — Oak Bay/Victoria (~48.41, -123.29..-123.30), Pat Bay
// (~48.65, -123.45), Nanaimo (~49.17..49.21, -123.93..-123.96), Parksville
// (~49.32, -124.28).
// Worst case: 10 camera rows, 10 outbound probes per sync.
//
// EXCLUDED after verification (kept out on purpose, see StructuredOutput):
// Mount Washington's two Ozolio cams (already extraCams mtwash:nordic/cam2) and
// its only other on-page "cam" (2phAAolR85w) which is a 2023 timelapse VIDEO,
// not live; NAV CANADA DAWC metcam WxCam sites incl. Nanaimo Harbour id=43
// (the camera viewer is a JS SPA that fetches a session-bound image servlet —
// no stable directly-curlable .jpg, same reason ONC/rtsp.me manifests were
// skipped); Mount Cain / Strathcona Park Lodge / Camosun / North Island College
// (no first-party cam found); bcweathercams.ca + coastwebcams' other rows
// (DriveBC/WSDOT/Hakai images already seeded by their own modules, and Gulf-
// Islands-only Reolink views outside the VI scope).

const CLUSTER = 'Cameras & Live Media';
const CADENCE = 86_400;

const METAS: Record<string, SourceMeta> = {
  'victoria-golf-cams': {
    slug: 'victoria-golf-cams',
    name: 'Victoria Golf Club Cams (Oak Bay)',
    cluster: CLUSTER,
    cadenceSec: CADENCE,
    attribution: 'Victoria Golf Club via YouTube',
    licenseNote: 'YouTube ToS: playback via iframe player only — never extract HLS; live id rotates on restart',
  },
  'patbay-webcam': {
    slug: 'patbay-webcam',
    name: 'Pat Bay Webcam (Saanich Inlet)',
    cluster: CLUSTER,
    cadenceSec: CADENCE,
    attribution: 'patbaywebcam.com',
    licenseNote: 'Open JPEG on a public hobby weather-cam site, ToS-unreviewed — cache gently, drop on request',
  },
  'harling-point-cam': {
    slug: 'harling-point-cam',
    name: 'Harling Point Weather Station Cam (Oak Bay)',
    cluster: CLUSTER,
    cadenceSec: CADENCE,
    attribution: 'Harling Point Weather Station (namroc.com)',
    licenseNote: 'Open JPEG on a public weather-station site, ToS-unreviewed — cache gently, drop on request',
  },
  'coastwebcams-vi': {
    slug: 'coastwebcams-vi',
    name: 'CoastWebcams Vancouver Island Cams',
    cluster: CLUSTER,
    cadenceSec: CADENCE,
    attribution: 'coastwebcams.ca',
    licenseNote: 'Self-hosted operator JPEGs on a third-party host, ToS-unreviewed — cache gently, drop on request',
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
  // when the exact mast location is unknown, the cam is placed at a site
  // estimate and approxKm is the uncertainty radius in km (map draws a circle).
  approxKm?: number;
  attribution: string;
  sourceSlug: string;
  check: Check;
}

const ytEmbed = (id: string) => `https://www.youtube.com/embed/${id}`;
const ytWatch = (id: string) => `https://www.youtube.com/watch?v=${id}`;
const coastJpg = (cam: string) => `https://www.coastwebcams.ca/Reolink/${cam}.jpg`;

// Every URL below returned the expected 200 on 2026-06-11/12 (oEmbed JSON for
// the watch ids, image/jpeg for snapshots). Golf-hole coordinates are nudged
// per camera around the Victoria Golf Club links (Oak Bay) so markers do not
// stack exactly; the underlying ids were resolved by following the club's
// camstreamer.com/embed/<key> 302s to their canonical YouTube ids.
const CATALOG: CatalogCam[] = [
  // ---- victoria-golf-cams ----
  // Victoria Golf Club, 1110 Beach Dr, Oak Bay — seaside links on the Trial
  // Islands shore of Juan de Fuca Strait. Five fixed live hole cams; exact
  // course coords are well known, so no approxKm.
  {
    slug: 'ytlive:vicgolf-4th-tee',
    name: 'Victoria Golf Club — 4th Tee (Oak Bay)',
    lat: 48.4142,
    lng: -123.2968,
    kind: 'iframe',
    mediaUrl: ytEmbed('tD34sHm2KRM'),
    attribution: 'Victoria Golf Club via YouTube',
    sourceSlug: 'victoria-golf-cams',
    check: { kind: 'oembed', watch: ytWatch('tD34sHm2KRM') },
  },
  {
    slug: 'ytlive:vicgolf-18th-1st',
    name: 'Victoria Golf Club — 18th Green & 1st Tee (Oak Bay)',
    lat: 48.4151,
    lng: -123.2959,
    kind: 'iframe',
    mediaUrl: ytEmbed('M9MyD4QLzpI'),
    attribution: 'Victoria Golf Club via YouTube',
    sourceSlug: 'victoria-golf-cams',
    check: { kind: 'oembed', watch: ytWatch('M9MyD4QLzpI') },
  },
  {
    slug: 'ytlive:vicgolf-6th-10th',
    name: 'Victoria Golf Club — 6th Fairway & 10th Green (Oak Bay)',
    lat: 48.4136,
    lng: -123.2955,
    kind: 'iframe',
    mediaUrl: ytEmbed('zmM1Wt4znos'),
    attribution: 'Victoria Golf Club via YouTube',
    sourceSlug: 'victoria-golf-cams',
    check: { kind: 'oembed', watch: ytWatch('zmM1Wt4znos') },
  },
  {
    slug: 'ytlive:vicgolf-11th-tee',
    name: 'Victoria Golf Club — 11th Tee (Oak Bay)',
    lat: 48.4129,
    lng: -123.2962,
    kind: 'iframe',
    mediaUrl: ytEmbed('z_XVIEgEjVA'),
    attribution: 'Victoria Golf Club via YouTube',
    sourceSlug: 'victoria-golf-cams',
    check: { kind: 'oembed', watch: ytWatch('z_XVIEgEjVA') },
  },
  {
    slug: 'ytlive:vicgolf-shortgame',
    name: 'Victoria Golf Club — Short Game Area (Oak Bay)',
    lat: 48.4147,
    lng: -123.2972,
    kind: 'iframe',
    mediaUrl: ytEmbed('0g9JO2B5Qk8'),
    attribution: 'Victoria Golf Club via YouTube',
    sourceSlug: 'victoria-golf-cams',
    check: { kind: 'oembed', watch: ytWatch('0g9JO2B5Qk8') },
  },

  // ---- patbay-webcam ----
  // Dedicated public weather webcam over Patricia Bay / Saanich Inlet near
  // Sidney (North Saanich). The mast location is not published, so the cam is
  // placed at the Pat Bay shoreline with a 3 km uncertainty radius.
  {
    slug: 'patbay:webcam',
    name: 'Pat Bay Webcam (Saanich Inlet, North Saanich)',
    lat: 48.654,
    lng: -123.451,
    kind: 'snapshot',
    mediaUrl: 'https://patbaywebcam.com/webcam/pb.jpg',
    refreshSec: 300,
    approxKm: 3,
    attribution: 'patbaywebcam.com',
    sourceSlug: 'patbay-webcam',
    check: { kind: 'image' },
  },

  // ---- harling-point-cam ----
  // Harling Point Weather Station (Gonzales / Oak Bay, Victoria) — a small,
  // long-running public weather station broadcasting a fixed sea-facing frame.
  // Known site, exact coords.
  {
    slug: 'harling-point:cam',
    name: 'Harling Point Weather Station Cam (Oak Bay, Victoria)',
    lat: 48.4108,
    lng: -123.2884,
    kind: 'snapshot',
    mediaUrl: 'https://namroc.com/dev/pic0.jpg',
    refreshSec: 300,
    attribution: 'Harling Point Weather Station (namroc.com)',
    sourceSlug: 'harling-point-cam',
    check: { kind: 'image' },
  },

  // ---- coastwebcams-vi ----
  // Three Vancouver Island views coastwebcams.ca self-hosts as open JPEGs. The
  // exact camera masts are not published, so each is placed at the named
  // locality with a small uncertainty radius.
  {
    slug: 'coastwebcams:departure-bay',
    name: 'Departure Bay Cam (Nanaimo)',
    lat: 49.2127,
    lng: -123.9566,
    kind: 'snapshot',
    mediaUrl: coastJpg('DepartureBay'),
    refreshSec: 120,
    approxKm: 3,
    attribution: 'coastwebcams.ca',
    sourceSlug: 'coastwebcams-vi',
    check: { kind: 'image' },
  },
  {
    slug: 'coastwebcams:nanaimo-waterfront',
    name: 'Nanaimo Waterfront Cam',
    lat: 49.1659,
    lng: -123.9331,
    kind: 'snapshot',
    mediaUrl: coastJpg('NanaimoWaterfront'),
    refreshSec: 120,
    approxKm: 3,
    attribution: 'coastwebcams.ca',
    sourceSlug: 'coastwebcams-vi',
    check: { kind: 'image' },
  },
  {
    slug: 'coastwebcams:tigh-na-mara',
    name: 'Tigh-Na-Mara / Parksville Strait Cam',
    lat: 49.3181,
    lng: -124.2753,
    kind: 'snapshot',
    mediaUrl: coastJpg('TighNaMara'),
    refreshSec: 120,
    approxKm: 4,
    attribution: 'coastwebcams.ca',
    sourceSlug: 'coastwebcams-vi',
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
      // Sequential on purpose — 10 probes once a day, several against small
      // hobby/operator hosts we promised to treat gently.
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
          approxKm: cam.approxKm,
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
      await ctx.runMutation(internal.feeds.camsTrails.ingest, {
        cams,
        sources: [...bySource.values()],
      });
    } catch (e) {
      await ctx.runMutation(internal.feeds.camsTrails.fail, { error: String(e) });
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
        approxKm: c.approxKm,
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
