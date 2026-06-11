# DECISIONS.md — Locked build decisions

> Phase 0 gate artifact, 2026-06-11. Every §5 decision from BRIEF.md resolved, with the recon evidence behind it. Versions and prices were verified live on this date (see SOURCES.md and the platform recon). Change a decision here before changing it in code.

## D1. Map stack

**Decision:** MapLibre GL JS `^5` (globe projection is built-in since v5.0.0) + deck.gl `^9.3` integrated via `MapboxOverlay` from `@deck.gl/mapbox` in **interleaved** mode (shared WebGL2 context, `beforeId` layer placement).

**Basemap:** **OpenFreeMap dark** — `https://tiles.openfreemap.org/styles/dark` verified live: keyless, no registration, no request limits, commercial use explicitly allowed, MIT. We fork the dark style JSON into the repo, desaturate it for the intelligence look (muted land, near-black water, low-contrast roads), and keep pointing at OpenFreeMap tile/glyph/sprite endpoints. Required attribution: "OpenFreeMap © OpenMapTiles, Data from OpenStreetMap".

- **Fallback:** Protomaps self-hosted pmtiles (daily planet builds, ToS-clean) if OpenFreeMap ever degrades.
- **Rejected:** CARTO dark-matter — endpoints live and CORS-open, but production/commercial use requires an Enterprise license. Dev-emergency only, never shipped.
- Basemap stays behind an interface so a Mapbox upgrade (premium dark + 3D terrain) remains a config swap.

**Bonus from recon:** ECCC GeoMet WMS responds with `Access-Control-Allow-Origin: *` — radar/satellite/lightning-density rasters can load **directly in the browser** as MapLibre raster sources (no Convex proxy, no bandwidth cost).

## D2. AIS / live vessels

**Decision:** Option A from the brief — a dedicated Node worker holding the `wss://stream.aisstream.io/v0/stream` WebSocket (VI bbox subscription, `PositionReport` + `ShipStaticData`), writing positions into Convex via an `httpAction` guarded by a shared secret. aisstream.io protocol verified from docs: subscription JSON within 3s of connect, free key via GitHub sign-in, beta/no-SLA → worker gets reconnect + backoff, and the app degrades to last-known-position + stale flag whenever the worker is down.

**Hosting reality (changed since the brief was written):** there is no usable free tier for a 24/7 socket anymore. Render free spins down (outbound WS doesn't keep it alive), Railway is $5/mo Hobby, Koyeb's free tier closed, Fly.io is pay-as-you-go ≈ **$2.02/mo** (shared-cpu-1x 256MB, card required). **The worker is built host-agnostic (single Dockerfile + env vars); the ~$2–5/mo hosting decision is Samuel's at deploy time** — Fly.io recommended; running it on any always-on home box is equally fine. Nothing else in BlindSpot depends on the worker being up.

**Supplement:** BC Ferries vessel positions (polled REST, verified) run as a normal Convex feed module regardless, so the SEAS page is never empty.

## D3. App gating + privacy

**Decision:** **Convex Auth** (`@convex-dev/auth` 0.0.94, Password provider) — zero external service, free, officially maintained (beta; pinned exact). Single operator account; no public signup UI. This keeps rebroadcast-restricted imagery (DriveBC cams, Windy) private, per ToS posture in the brief.

- Footer disclaimer on every page: "Aggregated public OSINT; informational only; not for life-safety decisions."
- Per-source attribution rendered from the `sources` registry (attribution strings live in SOURCES.md and are stamped into each feed module).
- Switch to Clerk only if MFA/passkeys are ever wanted.

## D4. AI analyst

**Decision:** Claude API, server-side only (Convex actions, key in Convex env).

- **NL analyst console:** `claude-sonnet-4-6` ($3/$15 per MTok) with **prompt caching** on the system prompt + tool definitions (cache reads $0.30/MTok). Tool-use loop over read-only Convex queries + Turf filters. Upgrade path to `claude-opus-4-8` if reasoning quality disappoints.
- **Auto-INTSUM cron:** `claude-haiku-4-5` ($1/$5) every 4 hours + on-demand regenerate. If digest quality wants more, move to Sonnet 4.6 via the **Batches API** ($1.50/$7.50 — near-Haiku cost, Sonnet quality, fine for a latency-insensitive cron).
- Note: Opus 4.8-class models are adaptive-thinking-only (no temperature/top_p, no prefills) — irrelevant for Sonnet/Haiku defaults but recorded so nobody trips on it later.

## D5. Notification channels

**Decision:** **Web push (PWA)** + **ntfy.sh**.

- Web push: `web-push` 3.6.7 inside a `"use node"` Convex action; VAPID keys in Convex env (`npx web-push generate-vapid-keys`); subscriptions in a Convex table; service worker via `vite-plugin-pwa` 1.3.0 (peer-verified with Vite 8).
- ntfy.sh: keyless publish (`POST ntfy.sh/<topic>`) from the default Convex runtime — the topic name is the secret, so use a long random topic stored in Convex env. This is the zero-setup mobile channel.
- Browser TTS for `critical` severity. Severity tiers info/watch/warning/critical with per-tier rate limits + `dedupeKey`, per §8.8.

## D6. Self-hosted SDR

**Decision:** Deferred — optional hardware tier, documented in RUNBOOK.md as a future add (RTL-SDR + dump1090 feeding the same worker→Convex path as AIS). Nothing blocks on it.

## D7. Frontend stack details

| Concern | Choice | Pinned |
|---|---|---|
| Build | Vite | 8.0.16 |
| Router | @tanstack/react-router (type-safe, Vite-first, SPA-native) | 1.170.x |
| Server state | Convex `useQuery` (reactive — no polling layer needed) | convex 1.41.0 |
| Client/UI state | zustand (one small store for map/UI ephemera) | 5.0.x |
| Motion | `motion` package (Framer Motion's current name; import `motion/react`) | 12.x |
| Charts | Recharts | 3.8.x |
| Geospatial | @turf/turf 7.3.x, satellite.js 7.0.x (TLE propagation), suncalc 1.9 (sun/moon computed locally — flaky astronomy APIs not load-bearing) | — |
| Media | hls.js 1.6.x behind the `<LiveMedia>` kind resolver | — |
| Map | maplibre-gl ^5, deck.gl ^9.3 | — |
| Auth | @convex-dev/auth | **0.0.94 exact** (pre-1.0) |

## D8. Convex budget + cadence plan

Free tier verified: **1M function calls/mo, 20 GB-h action compute, 0.5 GB DB storage, 1 GB DB bandwidth.** A simple feed tick ≈ ~3 calls (action + runQuery + runMutation); the brain tick is batched to ~4–6 calls (one context query, one commit mutation — see ARCHITECTURE §5/§11). All four budget dimensions are modeled — calls, storage, **bandwidth**, compute:

- **Fast lane (90–120s, standardized):** quakes, aircraft, weather-alert check, NAAD check. ~5 fast feed jobs ≈ 350–550K calls/mo — the dominant line; tune intervals before adding fast jobs.
- **Brain tick:** single 120s cron (fusion + geofence + anomaly; threat every 8th tick) ≈ 130–190K calls/mo.
- **AIS worker ingest:** 30s batches (aligned with position thinning) ≈ 90–170K calls/mo — this line was invisible in the first draft and is now budgeted.
- **Medium (5–15 min):** radar timestamp, conditions, AQHI, wildfire, transit GTFS-RT, outages, ferries, buoys, news RSS, GDELT.
- **Slow (30–60 min / daily):** tides predictions, TLEs (daily — CelesTrak etiquette), drought, snow, permits, events, INTSUM (4 h), pattern-of-life (daily).
- **Reactive re-runs bill too:** an always-on WALL client re-executes subscribed queries on every relevant write. Mover layers therefore subscribe to throttled `snapshots` docs (≥30s apart, ~20KB), never raw entity scans — this bounds both calls and bandwidth.
- **Storage (0.5 GB) is the hard ceiling:** retention is a self-rescheduling batch loop (hourly single-batch can't keep up with mover inflow); `tracks` 48 h, `readings` downsampled then 7 d, `entities` stale 7 d, `notifications` 30 d, `signals` per-kind TTL. AIS thins to one position per vessel per 30 s + displacement gating before writing.
- **Bandwidth (1 GB/mo):** counters maintained incrementally in `snapshots` by ingest mutations — never per-tick table scans; `raw` ≤ 2KB; polygons simplified before write.
- **Total estimate ≈ 1–1.3M calls/mo** → free tier ± ~$1 of overage. **Flag for Samuel:** staying strictly free-tier (no card) means a bandwidth overrun can stop mutations; enabling pay-as-you-go (≈$1–3/mo realistic) removes that cliff. Same decision moment as the D2 worker hosting (~$2/mo) — both at deploy time.

## D9. Excluded sources (licensing guardrails — do not revisit casually)

| Source | Why excluded |
|---|---|
| Blitzortung/LightningMaps | ToS restricts to private/entertainment, prohibits storm-warning use; **replaced by ECCC GeoMet `Lightning_2.5km_Density` WMS layer (verified, free)** |
| LiveATC | ToS flatly prohibits using streams in third-party apps — no in-platform embed. SIGNALS page links out as explicit secondary action only |
| Broadcastify | Embedding requires their paid API/player; BC public-safety radio is mostly encrypted anyway. Same link-out-only treatment |
| VicPD crime map | Rebuilt on Motorola CityProtect (vendor iframe, ToS-restricted). Crime coverage = aggregate open-data releases + news, honestly thin, per brief |
| Windy Webcams | **Deferred, not excluded:** free-tier image URLs expire ~10 min and require just-in-time re-minting via the keyed API — needs a JIT-mint query the cameras schema doesn't carry yet. Revisit only if DriveBC + institutional + YouTube cams leave real gaps |

## D12. Aircraft feed strategy (amended after ToS review)

**Decision:** the live-aircraft backbone is the **community aggregator trio — adsb.fi + adsb.lol + airplanes.live — behind one readsb-shape adapter with failover** (all three verified live, keyless, same response family; per-source rate limits in SOURCES.md). **OpenSky is demoted to an optional supplement:** recon found its 2026 ToS requires a prior written agreement for automated/operational use even non-commercially. We don't build on a feed we'd be violating; if Samuel wants OpenSky's research-grade data later, the path is asking them for the agreement, then enabling the already-specced OAuth2 module (token cache in `apiTokens`).

## D10. Repo + deploy shape

- Nested git repo (home dir is an accidental repo — never commit from `~`). Public GitHub at Phase 7; repo contains no data/keys, app itself stays auth-gated.
- Vercel: Vite SPA needs the rewrite `{"source":"/(.*)","destination":"/index.html"}`; build command `npx convex deploy --cmd 'npm run build'` with `CONVEX_DEPLOY_KEY` env var.
- All third-party keys + Claude key in Convex env vars only. Client bundle gets zero secrets (grep-verified in Phase 6).

## D11. VI bbox (shared constant)

`SW 48.20, -125.30 → NE 51.10, -123.10` — single exported constant used by every feed module, with per-source tuning where recon found it matters (e.g. Tofino sits just west of the box for offshore feeds; the NE corner clips Sunshine Coast pages in ECCC citypage — filter by region name there; Cascadia seismic uses a wider 46–52 / −132–−121 box deliberately).
