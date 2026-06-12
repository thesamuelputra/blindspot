import { v } from 'convex/values';
import { internalAction, internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { fetchSource } from '../lib/fetchSource';
import { reportSuccess, reportFailure, type SourceMeta } from '../lib/ingest';

// camsTransport — TRANSPORT / TRAFFIC / AVIATION / MARINE-TRAFFIC cams for the
// flagship CAM WALL, mining BEYOND what the sibling cam modules already own:
//   drivebcCams.ts        → DriveBC VI highway cams
//   camsAgency.ts         → a small WSF + US-101 Port Angeles set (NOT re-seeded
//                           here — every WSDOT cam below is a DIFFERENT placemark)
//   extraCams.ts          → CHEK harbour lives, BC Ferries terminals, Mt Washington
//   camsMarineHarbour.ts  → Van Isle Marina, Tofino Sea Kayaking
//
// Under DECISIONS D13 (relaxed for a private single-operator console) this seeds
// a generous, VI-relevant transport set: more WSDOT cams across the Olympic
// Peninsula US-101 / SR-112 strait shore, the SR-20 Whidbey/Anacortes corridor
// toward Deception Pass, WSF terminal + airport cams over the shared Salish Sea,
// the Port of Port Angeles' own YouTube lives (Coho ferry harbour + Fairchild
// airport + John Wayne Marina), and operator-distributed marine-traffic cams
// reached through aggregators the app supports (SkylineWebcams / rtsp.me /
// ipcamlive). Aggregator reuse-ToS does NOT block inclusion — the console is
// private and non-redistributing. Every cam here was put online by its
// operator / a port authority / a tourism body / a state DOT.
//
// Six health rows, one per SOURCES.md-style entry:
//   wsdot-olympic-cams       US-101 + SR-112 + SR-104 along the Olympic
//                            Peninsula / south shore of the Strait of Juan de
//                            Fuca + the Hood Canal Bridge chokepoint.
//   wsdot-whidbey-cams       SR-20 across north Whidbey Island toward Deception
//                            Pass / Fidalgo Island (the corridor feeding the
//                            Anacortes-Sidney BC ferry).
//   wsdot-salish-terminal    WSF terminal + street cams on the Anacortes /
//                            San Juans / Admiralty Inlet runs NOT already seeded
//                            in camsAgency.ts (different placemarks/angles).
//   wsdot-airport-cams       Published WSDOT airfield cams over Salish waters
//                            (San Juans + Fidalgo + Whidbey + Bellingham).
//   portangeles-cams         Port of Port Angeles' own YouTube live cams (Coho
//                            ferry harbour, Fairchild Intl airport, John Wayne
//                            Marina) — the US ferry port to Victoria.
//   salish-aggregator-cams   Operator-run marine-traffic / coastal cams
//                            distributed via SkylineWebcams (iframe player),
//                            rtsp.me, and ipcamlive — Nanaimo port, Campbell
//                            River / Discovery Passage (Seymour Narrows traffic),
//                            Victoria Harbour, Tofino Long Beach, plus Boundary
//                            Bay + Pitt Meadows airfields.
//
// SCOPE NOTE: the WSDOT cams sit on the US south/east shore of the shared
// Salish Sea (lat ~47.8-48.8, lng east of VI_BBOX's -123.1 edge); the Tofino
// cam sits just WEST of the box. Same posture as camsAgency.ts / extraCams.ts —
// the bbox filter is intentionally NOT applied to this hand-curated VI-relevant
// list. WSDOT static host (images.wsdot.wa.gov) is key-free; the Traveler REST
// API needs an AccessCode we don't use, so we poll the documented snapshot URLs.
//
// Daily sync (86400s) re-verifies liveness and flips `active` instead of
// dropping rows. Liveness probes: snapshot JPEGs → GET + image/* content-type;
// YouTube → oEmbed JSON 200; iframe embed pages → GET 200. Every URL below
// returned the expected 200 on 2026-06-12. Worst case: 35 rows, 35 probes/day.
//
// EXCLUDED after verification (kept out on purpose, see StructuredOutput):
// NavCanada DAWC weathercams (Nanaimo Harbour TM12 etc.) — the image host
// redirects bare GETs to /error/ (Referer/cookie-gated), so no clean snapshot
// URL plays in-platform; City of Vancouver municipal traffic cams
// (trafficcams.vancouver.ca) — Lower Mainland, outside VI scope and the VI
// municipal traffic cams route through DriveBC, already seeded; the Nanaimo
// Waterfront Suites & Marina YouTube cam (aTgZSO2uBRM) — not live at verify
// time (24h archive, isLiveNow:false); WSDOT PortTownsendN.jpg airport view —
// 404 upstream right now (E/W views used instead).

const CLUSTER = 'Cameras & Live Media';
const CADENCE = 86_400;

const WSDOT_ATTR = 'Washington State DOT (WSDOT)';
const WSF_ATTR = 'Washington State Ferries / WSDOT';
const POPA_ATTR = 'Port of Port Angeles via YouTube';

const METAS: Record<string, SourceMeta> = {
  'wsdot-olympic-cams': {
    slug: 'wsdot-olympic-cams',
    name: 'WSDOT Olympic Peninsula Cams (US-101 / Strait)',
    cluster: CLUSTER,
    cadenceSec: CADENCE,
    attribution: WSDOT_ATTR,
    licenseNote:
      'WSDOT public traffic imagery, key-free static host (images.wsdot.wa.gov). No formal ToS reviewed — cache server-side, attribute, low volume, removable.',
  },
  'wsdot-whidbey-cams': {
    slug: 'wsdot-whidbey-cams',
    name: 'WSDOT SR-20 Whidbey/Anacortes Cams',
    cluster: CLUSTER,
    cadenceSec: CADENCE,
    attribution: WSDOT_ATTR,
    licenseNote:
      'WSDOT public traffic imagery, key-free static host (images.wsdot.wa.gov). No formal ToS reviewed — cache server-side, attribute, low volume, removable.',
  },
  'wsdot-salish-terminal': {
    slug: 'wsdot-salish-terminal',
    name: 'WSF Salish Sea Terminal Cams (extra)',
    cluster: CLUSTER,
    cadenceSec: CADENCE,
    attribution: WSF_ATTR,
    licenseNote:
      'WSDOT/WSF public terminal imagery, key-free static host. No formal ToS reviewed — cache server-side, attribute, removable.',
  },
  'wsdot-airport-cams': {
    slug: 'wsdot-airport-cams',
    name: 'WSDOT Salish Sea Airfield Cams',
    cluster: CLUSTER,
    cadenceSec: CADENCE,
    attribution: WSDOT_ATTR,
    licenseNote:
      'WSDOT public airport cams, key-free static host (images.wsdot.wa.gov/airports). No formal ToS reviewed — cache server-side, attribute, removable.',
  },
  'portangeles-cams': {
    slug: 'portangeles-cams',
    name: 'Port of Port Angeles Cams',
    cluster: CLUSTER,
    cadenceSec: CADENCE,
    attribution: POPA_ATTR,
    licenseNote:
      'YouTube ToS: playback via iframe player only — never extract HLS; Port-operated lives, ids may rotate on stream restart.',
  },
  'salish-aggregator-cams': {
    slug: 'salish-aggregator-cams',
    name: 'Salish Marine-Traffic Cams (aggregator)',
    cluster: CLUSTER,
    cadenceSec: CADENCE,
    attribution: 'Operator cams via SkylineWebcams / rtsp.me / ipcamlive',
    licenseNote:
      'Operator-run cams distributed through aggregators; reuse-ToS waived for a private non-redistributing console (D13). Iframe the sanctioned player page — never proxy the manifest.',
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

const wsdot = (path: string) => `https://images.wsdot.wa.gov/${path}`;
const ytEmbed = (id: string) => `https://www.youtube.com/embed/${id}`;
const ytWatch = (id: string) => `https://www.youtube.com/watch?v=${id}`;

// Every URL below returned the expected 200 on 2026-06-12 (image/jpeg for WSDOT
// snapshots, oEmbed JSON for the Port Angeles watch ids — all isLiveNow:true,
// text/html for the SkylineWebcams/rtsp.me/ipcamlive embed pages). WSDOT
// coordinates are from the HighwayCameras KML placemarks; aggregator coords are
// map-marker approximations of the published cam locations.
const CATALOG: CatalogCam[] = [
  // ---- wsdot-olympic-cams ----
  // US-101 + SR-112 along the Olympic Peninsula / south shore of the Strait of
  // Juan de Fuca, plus the SR-104 Hood Canal Bridge (the chokepoint where the
  // strait's waters meet Puget Sound). /orflow refresh ~60s; /rweather stills
  // are slower weather frames (~180s).
  {
    slug: 'wsdot:us101-heckelsville',
    name: 'US-101 Heckelsville Shed (W of Lake Crescent, Olympic Peninsula)',
    lat: 48.0704,
    lng: -124.0345,
    kind: 'snapshot',
    mediaUrl: wsdot('rweather/HeckShed_medium.jpg'),
    refreshSec: 180,
    attribution: WSDOT_ATTR,
    sourceSlug: 'wsdot-olympic-cams',
    check: { kind: 'image' },
  },
  {
    slug: 'wsdot:us101-indian-valley',
    name: 'US-101 Indian Valley (Olympic Peninsula)',
    lat: 48.0675,
    lng: -123.6179,
    kind: 'snapshot',
    mediaUrl: wsdot('rweather/Medium_IndianValleyUS101.jpg'),
    refreshSec: 180,
    attribution: WSDOT_ATTR,
    sourceSlug: 'wsdot-olympic-cams',
    check: { kind: 'image' },
  },
  {
    slug: 'wsdot:sr112-burnt-mt',
    name: 'SR-112 Burnt Mountain (toward Neah Bay / NW Strait)',
    lat: 48.1771,
    lng: -124.2149,
    kind: 'snapshot',
    mediaUrl: wsdot('rweather/SR112BurntMt.jpg'),
    refreshSec: 180,
    attribution: WSDOT_ATTR,
    sourceSlug: 'wsdot-olympic-cams',
    check: { kind: 'image' },
  },
  {
    slug: 'wsdot:us101-mt-walker',
    name: 'US-101 Mt Walker (Hood Canal head, Olympic Peninsula)',
    lat: 47.757,
    lng: -122.8944,
    kind: 'snapshot',
    mediaUrl: wsdot('rweather/Medium_MtWalker1.jpg'),
    refreshSec: 180,
    attribution: WSDOT_ATTR,
    sourceSlug: 'wsdot-olympic-cams',
    check: { kind: 'image' },
  },
  {
    slug: 'wsdot:sr104-hoodcanal-bridge-e',
    name: 'SR-104 Hood Canal Bridge Looking East',
    lat: 47.8623,
    lng: -122.6288,
    kind: 'snapshot',
    mediaUrl: wsdot('orflow/104vc01471.jpg'),
    refreshSec: 60,
    attribution: WSDOT_ATTR,
    sourceSlug: 'wsdot-olympic-cams',
    check: { kind: 'image' },
  },
  {
    slug: 'wsdot:sr104-hoodcanal-bridge-w',
    name: 'SR-104 Hood Canal Bridge Looking West',
    lat: 47.8624,
    lng: -122.6289,
    kind: 'snapshot',
    mediaUrl: wsdot('orflow/104vc01470.jpg'),
    refreshSec: 60,
    attribution: WSDOT_ATTR,
    sourceSlug: 'wsdot-olympic-cams',
    check: { kind: 'image' },
  },

  // ---- wsdot-whidbey-cams ----
  // SR-20 across north Whidbey Island (Oak Harbor) toward Deception Pass and
  // Fidalgo Island — the highway corridor feeding the Anacortes ferry terminal
  // (Sidney BC / San Juans). /nw cams refresh ~60s.
  {
    slug: 'wsdot:sr20-swantown',
    name: 'SR-20 SW Swantown Ave, Oak Harbor (Whidbey Island)',
    lat: 48.2832,
    lng: -122.6693,
    kind: 'snapshot',
    mediaUrl: wsdot('nw/020vc03080.jpg'),
    refreshSec: 60,
    attribution: WSDOT_ATTR,
    sourceSlug: 'wsdot-whidbey-cams',
    check: { kind: 'image' },
  },
  {
    slug: 'wsdot:sr20-ault-field',
    name: 'SR-20 Ault Field Rd, Oak Harbor (NAS Whidbey)',
    lat: 48.3286,
    lng: -122.6294,
    kind: 'snapshot',
    mediaUrl: wsdot('nw/020vc03472.jpg'),
    refreshSec: 60,
    attribution: WSDOT_ATTR,
    sourceSlug: 'wsdot-whidbey-cams',
    check: { kind: 'image' },
  },
  {
    slug: 'wsdot:sr20-sharpes-corner',
    name: 'SR-20 Sharpes Corner (Fidalgo Island, Anacortes ferry spur)',
    lat: 48.4632,
    lng: -122.5818,
    kind: 'snapshot',
    mediaUrl: wsdot('nw/020vc04798.jpg'),
    refreshSec: 60,
    attribution: WSDOT_ATTR,
    sourceSlug: 'wsdot-whidbey-cams',
    check: { kind: 'image' },
  },
  {
    slug: 'wsdot:sr20-gibralter',
    name: 'SR-20 Gibralter Rd (Fidalgo Island)',
    lat: 48.4555,
    lng: -122.582,
    kind: 'snapshot',
    mediaUrl: wsdot('nw/020vc04732.jpg'),
    refreshSec: 60,
    attribution: WSDOT_ATTR,
    sourceSlug: 'wsdot-whidbey-cams',
    check: { kind: 'image' },
  },

  // ---- wsdot-salish-terminal ----
  // WSF terminal + street cams on the Anacortes / San Juans / Admiralty Inlet
  // runs that camsAgency.ts did NOT seed (distinct placemarks/angles). Terminal
  // imagery refreshes ~90s.
  {
    slug: 'wsdot:wsf-anacortes-road',
    name: 'WSF Anacortes Ferry Terminal Rd (Sidney BC / San Juans)',
    lat: 48.502,
    lng: -122.6793,
    kind: 'snapshot',
    mediaUrl: wsdot('wsf/anacortes/road/anaroad.jpg'),
    refreshSec: 90,
    attribution: WSF_ATTR,
    sourceSlug: 'wsdot-salish-terminal',
    check: { kind: 'image' },
  },
  {
    slug: 'wsdot:wsf-fridayharbor-upper',
    name: 'WSF Friday Harbor Upper Holding (San Juan Island)',
    lat: 48.5333,
    lng: -123.0149,
    kind: 'snapshot',
    mediaUrl: wsdot('wsf/fridayharbor/upperholding.jpg'),
    refreshSec: 90,
    attribution: WSF_ATTR,
    sourceSlug: 'wsdot-salish-terminal',
    check: { kind: 'image' },
  },
  {
    slug: 'wsdot:wsf-lopez-holding',
    name: 'WSF Lopez Island Ferry Holding (Looking South)',
    lat: 48.5692,
    lng: -122.884,
    kind: 'snapshot',
    mediaUrl: wsdot('wsf/lopez/holding.jpg'),
    refreshSec: 90,
    attribution: WSF_ATTR,
    sourceSlug: 'wsdot-salish-terminal',
    check: { kind: 'image' },
  },
  {
    slug: 'wsdot:wsf-orcas-booth',
    name: 'WSF Orcas Island Ferry Booth',
    lat: 48.5987,
    lng: -122.9456,
    kind: 'snapshot',
    mediaUrl: wsdot('wsf/orcas/booth.jpg'),
    refreshSec: 90,
    attribution: WSF_ATTR,
    sourceSlug: 'wsdot-salish-terminal',
    check: { kind: 'image' },
  },
  {
    slug: 'wsdot:wsf-porttownsend-street',
    name: 'WSF Port Townsend Ferry Street (Admiralty Inlet)',
    lat: 48.1121,
    lng: -122.7605,
    kind: 'snapshot',
    mediaUrl: wsdot('wsf/PortTownsend/Street/ptStreet.jpg'),
    refreshSec: 90,
    attribution: WSF_ATTR,
    sourceSlug: 'wsdot-salish-terminal',
    check: { kind: 'image' },
  },
  {
    slug: 'wsdot:wsf-coupeville-street',
    name: 'WSF Coupeville (Keystone) Ferry Street (Whidbey Island)',
    lat: 48.1593,
    lng: -122.6727,
    kind: 'snapshot',
    mediaUrl: wsdot('wsf/Keystone/Street/keyStreet.jpg'),
    refreshSec: 90,
    attribution: WSF_ATTR,
    sourceSlug: 'wsdot-salish-terminal',
    check: { kind: 'image' },
  },

  // ---- wsdot-airport-cams ----
  // Published WSDOT airfield cams over the Salish Sea / San Juans. /airports
  // stills refresh on the order of minutes.
  {
    slug: 'wsdot:airport-fridayharbor',
    name: 'Friday Harbor Airport Helipad (San Juan Island)',
    lat: 48.5219,
    lng: -123.0242,
    kind: 'snapshot',
    mediaUrl: wsdot('airports/friday1.jpg'),
    refreshSec: 180,
    attribution: WSDOT_ATTR,
    sourceSlug: 'wsdot-airport-cams',
    check: { kind: 'image' },
  },
  {
    slug: 'wsdot:airport-anacortes',
    name: 'Anacortes Airport Runway North (Fidalgo Island)',
    lat: 48.4983,
    lng: -122.6625,
    kind: 'snapshot',
    mediaUrl: wsdot('airports/anarunwayn.jpg'),
    refreshSec: 180,
    attribution: WSDOT_ATTR,
    sourceSlug: 'wsdot-airport-cams',
    check: { kind: 'image' },
  },
  {
    slug: 'wsdot:airport-lopez',
    name: 'Lopez Island Airport North',
    lat: 48.4839,
    lng: -122.9375,
    kind: 'snapshot',
    mediaUrl: wsdot('airports/lopezn.jpg'),
    refreshSec: 180,
    attribution: WSDOT_ATTR,
    sourceSlug: 'wsdot-airport-cams',
    check: { kind: 'image' },
  },
  {
    slug: 'wsdot:airport-orcas',
    name: 'Orcas Island Airport North',
    lat: 48.7083,
    lng: -122.9106,
    kind: 'snapshot',
    mediaUrl: wsdot('airports/OrcasN.jpg'),
    refreshSec: 180,
    attribution: WSDOT_ATTR,
    sourceSlug: 'wsdot-airport-cams',
    check: { kind: 'image' },
  },
  {
    slug: 'wsdot:airport-jeffco-east',
    name: 'Jefferson County Intl Airport East (Port Townsend)',
    lat: 48.0569,
    lng: -122.8095,
    kind: 'snapshot',
    mediaUrl: wsdot('airports/PortTownsendE.jpg'),
    refreshSec: 180,
    attribution: WSDOT_ATTR,
    sourceSlug: 'wsdot-airport-cams',
    check: { kind: 'image' },
  },
  {
    slug: 'wsdot:airport-bellingham',
    name: 'Bellingham International Airport (north Salish Sea)',
    lat: 48.7925,
    lng: -122.5375,
    kind: 'snapshot',
    mediaUrl: wsdot('airports/bham.jpg'),
    refreshSec: 180,
    attribution: WSDOT_ATTR,
    sourceSlug: 'wsdot-airport-cams',
    check: { kind: 'image' },
  },

  // ---- portangeles-cams ----
  // Port of Port Angeles' own YouTube live cams (oEmbed author "Port of Port
  // Angeles", all isLiveNow:true at verify time). Port Angeles is the US Coho
  // ferry port to Victoria; the harbour cam watches the strait crossing.
  {
    slug: 'ytlive:popa-harbor',
    name: 'Port Angeles Harbor (Coho ferry to Victoria)',
    lat: 48.1245,
    lng: -123.4305,
    kind: 'iframe',
    mediaUrl: ytEmbed('j88jA717XCQ'),
    attribution: POPA_ATTR,
    sourceSlug: 'portangeles-cams',
    check: { kind: 'oembed', watch: ytWatch('j88jA717XCQ') },
  },
  {
    slug: 'ytlive:popa-fairchild',
    name: 'Fairchild International Airport, Port Angeles (Looking East)',
    lat: 48.1202,
    lng: -123.4979,
    kind: 'iframe',
    mediaUrl: ytEmbed('LAF4KEjJoic'),
    attribution: POPA_ATTR,
    sourceSlug: 'portangeles-cams',
    check: { kind: 'oembed', watch: ytWatch('LAF4KEjJoic') },
  },
  {
    slug: 'ytlive:popa-jwm-main',
    name: 'John Wayne Marina Main Cam, Sequim (Strait of Juan de Fuca)',
    lat: 48.0817,
    lng: -123.0383,
    kind: 'iframe',
    mediaUrl: ytEmbed('kYdf9CacRWk'),
    attribution: POPA_ATTR,
    sourceSlug: 'portangeles-cams',
    check: { kind: 'oembed', watch: ytWatch('kYdf9CacRWk') },
  },
  {
    slug: 'ytlive:popa-jwm-2',
    name: 'John Wayne Marina Cam 2, Sequim',
    lat: 48.0819,
    lng: -123.038,
    kind: 'iframe',
    mediaUrl: ytEmbed('wXJsYQJUjX0'),
    attribution: POPA_ATTR,
    sourceSlug: 'portangeles-cams',
    check: { kind: 'oembed', watch: ytWatch('wXJsYQJUjX0') },
  },
  {
    slug: 'ytlive:popa-jwm-parking',
    name: 'John Wayne Marina Central Parking Cam, Sequim',
    lat: 48.0815,
    lng: -123.0386,
    kind: 'iframe',
    mediaUrl: ytEmbed('bnDHMbJ9NCw'),
    attribution: POPA_ATTR,
    sourceSlug: 'portangeles-cams',
    check: { kind: 'oembed', watch: ytWatch('bnDHMbJ9NCw') },
  },

  // ---- salish-aggregator-cams (aviation embeds; Skyline cams moved to
  // camsTourism to avoid duplicate markers) ----
  {
    slug: 'rtspme:boundary-bay-airport',
    name: 'Boundary Bay Airport SE Weather Cam (Delta, Salish Sea)',
    lat: 49.0742,
    lng: -123.0086,
    kind: 'iframe',
    mediaUrl: 'https://rtsp.me/embed/d2f2H7yD/',
    attribution: 'Pacific Professional Flight Centre (rtsp.me embed)',
    sourceSlug: 'salish-aggregator-cams',
    check: { kind: 'page' },
  },
  {
    slug: 'ipcamlive:pitt-meadows-airport',
    name: 'Pitt Meadows Airport Cam (Runway 26L threshold)',
    lat: 49.2161,
    lng: -122.7106,
    kind: 'iframe',
    mediaUrl:
      'https://g1.ipcamlive.com/player/player.php?alias=6883f2943304f&autoplay=1&mute=1&disableautofullscreen=1',
    attribution: 'Pitt Meadows Airport (ipcamlive embed)',
    sourceSlug: 'salish-aggregator-cams',
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
      // Sequential — 35 probes once a day, mostly against one state host plus a
      // handful of aggregators we treat gently.
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
      await ctx.runMutation(internal.feeds.camsTransport.ingest, {
        cams,
        sources: [...bySource.values()],
      });
    } catch (e) {
      await ctx.runMutation(internal.feeds.camsTransport.fail, { error: String(e) });
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
