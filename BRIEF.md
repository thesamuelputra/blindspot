# BLINDSPOT // Vancouver Island — Master Build Brief

> An all-source intelligence command center for Vancouver Island. The name is the mission: have none.
>
> This is the canonical, binding build brief. Phase gates and acceptance criteria are binding; the feed catalog is a verified floor (not a closed list); the intelligence layer (§8) is what separates this from a dashboard; the design spec is the bar for "done." `[VERIFIED 2026-06]` = confirmed live during research. `[VERIFY]` = high-probability but must be confirmed in Phase 0 before depending on it.

## 0. Mission

Build BlindSpot, a single-operator, all-source intelligence command center for Vancouver Island, British Columbia. It ingests every live and semi-live open-source signal relevant to the Island and its waters, fuses and correlates them, watches them for you, lets you interrogate them in natural language, and renders everything on an interactive map and a set of console pages that look and feel like mature Palantir software (Gotham / Foundry / Apollo lineage): dark, dense, precise, calm-but-alert, operational.

The core insight: breadth of feeds alone is a dashboard. BlindSpot is a platform — the value is the fusion, analysis, and workflow in §8 (correlation engine, geofence tripwires, watchlists, time-scrub replay, anomaly detection, an AI analyst, predictive overlays, alerting, incidents). Build the feeds and the brain.

### Hard product constraints (non-negotiable)

1. **Everything is local to Vancouver Island** (with an optional world mode, §8.9). Every Island feed is spatially/temporally filtered to the Island and its surrounding waters (Salish Sea, Juan de Fuca, west coast). Canonical bbox (tune per source, trim the mainland sliver): SW `48.20, -125.30` → NE `51.10, -123.10`. Keep it as one shared constant.
2. **In-platform rendering. Zero redirects.** All location-relevant media — webcams, IP/live/traffic cams, ATC audio, flight tracks, vessels, hotspots, alerts — must be viewable directly inside BlindSpot, on or from the map. The operator never gets bounced to an external site to see/hear something. "Open original ↗" may exist only as an explicit, secondary, user-initiated action — never an auto-redirect, never the primary way to view content.
3. **Overkill is the brief.** Breadth is a feature. The catalog (§10) is a floor; if you find a credible, location-relevant, legally-usable signal not listed — add it.
4. **Stack is fixed:** React + TypeScript frontend, Convex backend (data model, ingestion, scheduled polling, reactive queries, server-side AI), deploy frontend on Vercel, push a clean GitHub repo. Map + heavy geospatial viz via MapLibre GL JS + deck.gl (default; §6). Geospatial analytics via Turf.js. AI via the Anthropic/Claude API, server-side only.

## 1. Operating principles

* **Phase-gated.** Work the phases in §3 order. Don't implement before the plan is written and the catalog verified. Produce the named artifact at each gate.
* **Never hallucinate an API.** Before depending on any endpoint, verify it: fetch official docs, confirm base URL, auth, rate limits, response shape, CORS, and license/ToS. Several APIs changed recently (§11) — training data may be stale. When unsure, hit the endpoint and read the real response.
* **Stay deployable.** Get a "hello world" on Vercel + live Convex in Phase 2 before features. Never leave the tree red.
* **Server-side everything sensitive.** All third-party keys + the Claude API key live in Convex environment variables, used only inside Convex actions. The browser bundle contains zero secrets. The only client-visible key permitted is a map tile/style key if a keyed basemap is chosen — domain-restricted.
* **Commit hygiene.** Conventional commits, small/frequent, green per commit, no secrets/`.env`/junk in git.
* **Ask before irreversible/ambiguous actions outside this brief;** otherwise proceed on the defaults here and log it in `DECISIONS.md`.
* **Be honest about reality.** Many "live" sources are "semi-live" (poll cadence). Canadian real-time crime + most BC public-safety radio are limited/encrypted — say so, use what exists, never fabricate. Flaky/rate-limited sources degrade gracefully and surface their health.

## 2. Orchestration & sub-agents

Sub-agents may be deployed to parallelize work — only if it does not reduce output quality, coherence, or correctness. Speed never beats a single, coherent, correct product.

* Good parallelization (independent, well-bounded, clear acceptance criteria): Phase 0 recon by source cluster; Phase 3 one sub-agent per feed module; Phase 4 independent capability modules with no shared-state contention; Phase 6 parallel audits.
* The orchestrator owns and serializes — sub-agents conform, never redefine: the Convex schema, the design system/tokens + app shell + routing, the map layer registry + normalized record/contract shapes, the fusion-rule + alert contract, and final integration + the full audit.
* Rules: give each sub-agent a crisp spec (inputs: its `SOURCES.md` entry, schema, normalized record shape, tokens, layer-registry; outputs: module + cron + query + layer/panel + tests + `SOURCES.md` update). Never fan out two agents onto shared state simultaneously — serialize that. Integrate + audit after each wave. If parallelism risks divergence, don't.

## 3. Phases at a glance (build order)

0. **Recon** — verify + expand the catalog; resolve decisions. → `SOURCES.md`, `DECISIONS.md`
1. **Architecture & plan** — data model, ingestion design, IA/pages, capability architecture. → `ARCHITECTURE.md`, `PLAN.md`
2. **Foundation** — repo, Convex, app shell + Palantir chrome, base map, deploy early.
3. **Ingestion + layers** — every feed module (Tier 1 first), normalized into the core model, with health.
4. **The intelligence layer (§8)** — fusion/correlation, geofence tripwires, watchlists, time scrubber/replay, anomaly detection, AI analyst (NL console + auto-INTSUM), geo-analytics + predictive overlays, alerting pipeline, provenance + regional threat level, incident workspace. This is the differentiator.
5. **Command-center UI** — interactions, the pages, stat tiles, ticker, ⌘K, wall/kiosk mode, world mode, 3D/globe, PWA + push.
6. **Verify** — the audit cycle. → `AUDIT.md`
7. **Deploy** — GitHub + Vercel + Convex prod (+ AIS/SDR workers if used). → `README.md`, `RUNBOOK.md`

## 4. Phase 1 — Architecture & plan

### Data model (Convex) — core + capability tables

Normalized, source-agnostic core so the map/pages/brain don't care where a signal came from:

```ts
// sketch — refine in convex/schema.ts
// ---- feeds / signals ----
sources        // registry: id, name, cluster, status, lastSyncAt, lastError, cadence, attribution, licenseNote
signals        // universal geo-event: id, sourceId, kind, title, summary, severity, lat, lng, geojson?,
               //   startsAt, observedAt, expiresAt, raw(json), dedupeKey, confidence, provenance(json)
entities       // tracked things: aircraft, vessel, station, camera, fire, satellite, balloon — identity + current state
tracks         // rolling time-series positions for movers (capped/TTL)
cameras        // id, name, lat, lng, kind(snapshot|hls|iframe), mediaUrl/embedUrl, refreshSec, orientation, attribution
readings       // scalar time-series: weather, AQHI, tide, river, Kp, grid load, SWE, SST… (stationId, metric, value, unit, at)
alerts         // CAP/NAAD/weather/wildfire: area(geojson), severity, urgency, certainty, headline, effective, expires
// ---- the brain ----
geofences      // id, name, geojson(polygon), rule(enter|exit|dwell), dwellSec?, entityKinds[], severity, active, channels[]
watchlist      // id, kind(vessel|aircraft|other), identifier(mmsi|hex|…), label, notes, active
rules          // fusion/correlation rule defs: id, name, predicate(json/DSL), window, action, severity, active
derived        // fused outputs (also surfaced via signals kind="derived"): contributingIds[], rationale, confidence
baselines      // anomaly baselines: metric, window, mean, stddev, p95, updatedAt
incidents      // id, title, status, createdAt, signalIds[], geojson(annotations), notes[], log[]
notifications  // fired alerts: at, channel, payload, severity, ack, dedupeKey
threat         // computed regional threat level + contributing factors (singleton/rolling)
```

Index `(cluster)`, `(kind, observedAt)`, spatial bucketing, `dedupeKey`. Add TTL/retention crons to roll off old `tracks`/`readings`/`notifications` (keep enough for trails + sparklines + replay window; drop the rest to respect Convex limits).

### Ingestion pattern (core) `[VERIFIED 2026-06]`

Convex crons → `internalAction` (fetch + normalize) → `internalMutation` (upsert) → reactive `query` → live client. Facts:

* Actions can `fetch()` but cannot touch `ctx.db` — read/write via `ctx.runQuery`/`ctx.runMutation`; `"use node";` for Node libs.
* Crons are static in `convex/crons.ts` (`cronJobs()` → `crons.interval`/`crons.cron` → `internalAction`s). Stagger cadences, mind the Convex Starter/free budget:
  * Fast (~60–120s): quakes, flights, vessels, traffic incidents, active-alert checks, geofence/anomaly evaluation.
  * Medium (~5–15 min): weather, radar, AQHI, wildfire perimeters/hotspots, transit, outages, grid/net, cam metadata.
  * Slow (~30–60 min / daily): events, climate/drought, fire danger, tides, astronomy, satellite TLEs, INTSUM digest; news/GDELT ~10–15 min.
* Fetch docs at build time: `https://docs.convex.dev/llms.txt`, `/scheduling/cron-jobs`, `/scheduling/scheduled-functions`.
* The AIS websocket and any self-hosted SDR are exceptions — see §5 decisions.

### Information architecture (pages)

Multi-page console. Group as tabs if cleaner, but keep the "ops" feel:

1. **COMMAND** — master map; all layers toggleable; global status bar; live event ticker; key stat tiles; world-mode toggle.
2. **HAZARD** — seismic, weather alerts, wildfire (own cluster, §10), tsunami/ocean, public + AMBER alerts (NAAD).
3. **SKIES & SEAS** — flight tracker, vessel/AIS, BC Ferries, marine buoys + tides, space weather (aurora-over-Island).
4. **GROUND** — DriveBC traffic + construction + closures, highway/traffic cams, BC Transit live buses + schedules, power outages.
5. **SIGNALS (RF/SIGINT)** — live ATC audio, APRS beacons, radiosondes, GPS-jam map, SDR/ground stations.
6. **INFRASTRUCTURE** — grid load + transmission, internet/cyber weather, cell towers, EV charging, dams/reservoirs, building permits.
7. **PULSE** — breaking local news, events, civic advisories, crime (where it exists), aggregate regional social, GDELT regional events.
8. **ENVIRONMENT** — weather + radar, air quality, drought, streamflow/tides, SST/chlorophyll, sun/moon/ISS, climate.
9. **SPACE** — satellites/ISS/Starlink, launches, near-Earth objects, aurora, light pollution.
10. **ANALYST** — natural-language console over the data + auto-generated INTSUM (§8.6).
11. **INCIDENTS** — the analyst workspace: bundle correlated signals, annotate, draw, log, export a brief (§8.11).
12. **WORLD** — global threat board (GDELT, ACLED, sanctions, outbreaks, internet shutdowns, launches) on a globe.
13. **CAMS** — cam wall + map, all playing in-platform (flagship, §6).
14. **SYSTEM** — feed health, regional threat level, provenance, error log, cadence. The ops big-board.
15. **WALL** — full-screen kiosk/big-board mode: auto-rotating views for a wall display.
16. **INSPECTOR** (overlay) — deep dive on any selected entity (vessel/flight/quake/station/camera/satellite) with history + pattern-of-life.

## 5. Phase 1 — Decisions to lock (defaults given; record final in `DECISIONS.md`)

1. **Map stack** — default: MapLibre GL JS + deck.gl. Free, no token, self-hostable dark vector style (custom desaturated "intelligence" basemap). deck.gl layers: `ScatterplotLayer` (quakes/vessels/aircraft/incidents), `IconLayer` (oriented markers — aircraft/cam heading), `TripsLayer`/`ArcLayer` (trails/movement), `Heatmap`/`HexagonLayer` (density), `GeoJsonLayer` (fire/alert/zone polygons), animated pulse for new/critical. 3D/globe mode via MapLibre globe projection + deck.gl for world-mode + line-of-sight. Upgrade option: Mapbox GL basemap for premium dark + 3D terrain (domain-restricted token). Keep the basemap behind an interface.
2. **AIS / live vessels** — Convex can't hold a long-lived websocket. `aisstream.io` is a free bbox-filterable WebSocket. (A, default "overkill"): a tiny separate Node ingestion worker (Railway/Render/Fly free tier) holding the socket, filtering to the VI bbox, writing positions into Convex via the Convex client / `httpAction`. (B, "stay pure"): skip live AIS; use BC Ferries positions + a polling REST AIS source. Either way, degrade cleanly (last-known + stale flag) when the worker is down.
3. **App gating + privacy.** Some sources restrict public rebroadcast (BC HighwayCam imagery, Windy webcams, FIRMS/CWFIS/Open511 want attribution). Default: gate BlindSpot behind simple auth (Convex Auth or Clerk) as a private operator console — keeps redistribution honest and keys server-side. Footer disclaimer ("aggregated public OSINT; informational only; not for life-safety decisions") + per-source attribution.
4. **AI analyst scope.** Claude API server-side only (Convex action). The NL console is read-only over Convex data (it queries/summarizes; it does not take destructive actions). INTSUM runs on a cron. Pick the model in `DECISIONS.md`.
5. **Notification channels.** Choose from web push (PWA), ntfy, Telegram bot, Discord webhook, email. Default: web push + one of {ntfy, Telegram}. TTS for criticals in the browser.
6. **Self-hosted SDR (optional hardware tier).** RTL-SDR + `dump1090` (ADS-B) and/or an SDR AIS receiver — runs on a local box/Pi feeding Convex like the AIS worker. Receive-only, unencrypted public broadcasts only. Mark optional; don't block the build on it.

## 6. In-platform media rendering (graded requirement)

One `<LiveMedia>` component resolves by kind, all rendering inside BlindSpot:

* `snapshot` (JPEG/MJPEG) — most agency/traffic cams (incl. DriveBC HighwayCams). `<img>` refreshing on the cam's interval with a cache-bust param; "updated Xs ago" chip; lazy-load offscreen; pause when not visible.
* `hls` (`.m3u8`) — public live streams. HTML5 `<video>` + hls.js; check CORS/hotlink; fall back to iframe/poster if blocked.
* `iframe` (sanctioned embed) — Windy Webcams `player.live.embed`, YouTube Live (`/embed/<id>`), publisher players → sandboxed `<iframe>` inside the map popup / panel. Still in-platform.
* `audio` — LiveATC tower feeds, WebSDR/KiwiSDR → an in-platform `<audio>`/HLS player pinned to the map location. Listen without leaving.
* map integration — cams/audio are deck.gl `IconLayer` markers (oriented where known); click opens the feed in a map popover and can pin to the multi-cam CAMS grid; hover = thumbnail; never a navigation.
* Optional overkill (only if it doesn't hurt stability): RTSP-only / non-embeddable cam → restream via `go2rtc`/MediaMTX → HLS/WebRTC, played via hls.js/WebRTC. Prefer cams that already publish JPEG/MJPEG/HLS or a sanctioned embed.

**Hard guardrail — cameras & audio.** Public, sanctioned feeds only (government traffic cams; transit/port/airport/ski/harbour cams; publicly-listed aggregators like Windy; sanctioned YouTube live; public ATC/air-band; public web-SDR). Never Insecam-style directories or unsecured/private/residential cameras; never decode or retransmit encrypted radio. If public status is unclear, exclude it. Respect attribution + rate terms.

Non-media link-out sources (news, events) keep their summary/preview in-platform; the original URL is a secondary "open source ↗" only.

## 7. Phase 3 — Ingestion + layers

Each source = a self-contained feed module: `cron → internalAction(fetch+normalize) → internalMutation(upsert) → query → deck.gl layer + panel + freshness/health`. Build in tiers (Tier 1 = free + no-auth + high-signal first). Each module is typed, deduped, error-handled, writes its `sources` health row, stamps provenance + confidence on every record, and degrades gracefully. Natural place to fan out sub-agents (one per feed, §2). Use the catalog in §10.

## 8. THE INTELLIGENCE LAYER (Phase 4 — the differentiator)

A map with 40 layers is a dashboard. These capabilities make BlindSpot a platform. All run server-side in Convex (crons/actions) over the normalized model, surface results as `signals`/`derived`/`alerts`, and render through the same map/panels.

**8.1 Fusion & correlation engine.** A `rules` table of cross-feed predicates evaluated on a fast cron; matches emit `derived` signals with `contributingIds` + rationale + confidence. Seed rules:

* offshore quake + tide-gauge anomaly + ONC seafloor-pressure spike → tsunami watch;
* wildfire hotspot + wind vector + downwind AQHI degradation + smoke model → "smoke ETA Victoria ~18:00";
* vessel/operator matches an OpenSanctions entry → flag;
* aircraft squawks 7700/7600/7500 → auto-flag + fly-to;
* AIS gap on a watched vessel + last heading toward a sensitive zone → flag. One signal is data; three correlated signals is intelligence.

**8.2 Geofence tripwires.** Draw a polygon on the map (a strait, an approach corridor, a town, a fire perimeter) → `geofences` row with rule `enter|exit|dwell`. A cron tests tracked entities against active fences (Turf `booleanPointInPolygon` + dwell timers) and fires alerts. Examples: "tanker stops in Haro Strait," "fire ignites within 20 km of Port Alberni," "aircraft enters this box below 5,000 ft." Fences can be auto-generated (e.g., a buffer around each active fire).

**8.3 Watchlists / entities of interest.** Pin an MMSI (vessel) or hex/registration (aircraft) → `watchlist`; elevate its markers, keep full `tracks`, compute pattern-of-life (routes, dwell sites, timing). Public assets only — vessels, aircraft, infrastructure; never private individuals.

**8.4 Time as the second axis — scrubber + replay.** A temporal control on every map: rewind the last N hours and replay a fire's spread, a storm's passage, a vessel/aircraft track, an alert's full lifecycle. Backed by `tracks`/`readings`/`signals` history within the retention window. A static "now" map is half a god's eye.

**8.5 Anomaly detection.** `baselines` capture "normal" (typical air/sea counts, quake rate, AQHI, grid load) over rolling windows; a cron flags deviations: a loitering aircraft, a vessel going dark (AIS gap) — a real maritime-intel tell — a seismic swarm, an AQHI spike, an unusual traffic-flow collapse. Anomalies emit `derived` signals.

**8.6 The AI analyst (highest-leverage add).** Claude API, server-side via Convex action:

* NL console (ANALYST page): "show me ships near Nanaimo in the last hour," "any fires within 50 km of Duncan," "what changed since noon" → the action translates to Convex queries/Turf filters, runs them read-only, and answers in prose + map highlights.
* Auto-INTSUM (cron): a periodic intelligence summary — e.g., "14:00 — 3 active fires (largest 1,200 ha near Port Alberni; smoke ETA Victoria ~18:00); seas calm; 142 aircraft incl. 1 SAR; AQHI 3↑ Comox; M3.1 offshore; ferries on time." Store INTSUMs; show latest on COMMAND.

**8.7 Geospatial analytics & prediction (Turf.js + deck.gl).** Isochrones (evacuation reach / drive-time rings), viewshed/line-of-sight (what a cam/sensor sees, what a peak sees), nearest/proximity, KDE hotspots. Predictive overlays: fire-spread projection, smoke plume, storm track, storm surge, tonight's aurora visibility (OVATION + Kp), satellite-pass prediction (TLE propagation), dead-reckoned vessel/aircraft position during gaps.

**8.8 Alerting pipeline.** Severity-tiered (info/watch/warning/critical) → web push + chosen channels (ntfy/Telegram/Discord/email) via Convex; TTS for criticals ("Warning: tsunami advisory"). Dedupe via `notifications.dedupeKey`; acknowledge in-app; rate-limit per tier. A command center makes noise.

**8.9 Command-center surfaces.** WALL/kiosk mode (full-screen auto-rotating views + a TOC-style threat big-board). 3D terrain + globe for line-of-sight and world mode (flip the same fusion engine onto global feeds — GDELT/ACLED/sanctions/outbreaks/launches). PWA so the god's eye is in your pocket with push.

**8.10 Provenance, confidence & regional threat.** Every datum tagged `sourceId / observedAt / confidence / method`. Compute a real regional threat level from active hazards (weighted by severity/proximity/recency) behind the `SYSTEM NOMINAL / ELEVATED / HIGH` status line. SYSTEM page = a genuine ops board (feed health, latency, gaps, contributing threat factors). Provenance is what separates intel from vibes.

**8.11 Incident workspace.** Bundle correlated signals into a saved incident (`incidents`): annotate, draw on the map, keep a timeline log, attach feeds/cams, and export a brief (markdown/PDF). Even solo, that's the Palantir workflow — and it plugs straight into a deck.

## 9. Phases 5–7 — UI / verify / deploy

**Phase 5 — Command-center UI.** Map interactions (layer toggles with live counts + "updated Xs ago," hover reticle with live lat/long + UTC, click → inspector, fly-to, the time scrubber §8.4); the pages (§4); stat tiles + sparklines (Recharts); live event ticker; ⌘K command palette (jump to layer/place/entity/incident); alert/toast + TTS; WALL/kiosk + world + 3D/globe; PWA + push. ANALYST, INCIDENTS, CAMS, SYSTEM are flagship.

**Phase 6 — Verify** (audit cycle → `AUDIT.md`, resolve all). `tsc --noEmit`, lint, prod build; smoke-test every feed (data arrives, VI-filtered, correct layer, cams/audio actually play in-platform); each capability (fusion rule fires on synthetic input; geofence triggers; anomaly flags; scrubber replays; NL console answers; INTSUM generates; alerts deliver); data-freshness/staleness flags; map perf with thousands of markers (GPU layers, not DOM); empty/loading/error states everywhere; responsive/mobile + PWA install; keyboard + `prefers-reduced-motion`; no secrets in the client bundle (grep the build); attribution present where required.

**Phase 7 — Deploy.** Clean GitHub repo (thorough `README` — architecture diagram, full source list + attributions/licenses, env-var table, dev + deploy steps; `RUNBOOK.md` — Convex crons, AIS worker, SDR box, notification setup, AI keys). Vercel (build + env) + Convex prod (env + crons live) + worker hosts if used. Optional custom domain. Confirm end-to-end live ingestion + a working fusion alert + a generated INTSUM.

## 10. Data-feed catalog (verified floor — expand it)

Spatial-filter everything to the VI bbox (world feeds → WORLD page). Poll server-side via Convex unless noted. Attribute per ToS. `T1/T2/T3` = suggested build priority.

### ☼ WEATHER & ATMOSPHERE

* MSC GeoMet / ECCC `T1` `[VERIFIED 2026-06]` — current conditions, public forecasts, weather alerts, radar mosaic, NWP models. Free, anonymous, OGC. WMS radar/imagery (`geo.weather.gc.ca/geomet`); OGC API-Features alerts/forecasts (`api.weather.gc.ca`). → radar + alert polygons + readings.
* Open-Meteo `T1` `[VERIFY]` — free no-key current/forecast/historical numerics + charts.
* Lightning — Blitzortung / LightningMaps `T2` `[VERIFY]` — community real-time strikes; ToS/attribution; fading strike points.

### 🜨 EARTH & HAZARD (seismic / tsunami)

* USGS earthquakes `T1` `[VERIFY]` — FDSN/GeoJSON near-real-time, bbox (Cascadia). Points sized by magnitude + recency pulse.
* Earthquakes Canada (NRCan) `T1` `[VERIFY]` — Canadian seismic feed; cross-ref USGS. Note Canada's earthquake early-warning rollout (NRCan) — surface if available.
* Ocean Networks Canada — Oceans 3.0 `T1` `[VERIFIED 2026-06]` — UVic subsea observatories off the Island (Salish Sea/NEPTUNE/VENUS): seafloor seismometers, hydrophones, water temp/pressure/currents, tsunami-relevant. Free token (`data.oceannetworks.ca`), `scalardata`/`rawdata` near-real-time (100k cap, paginate). → readings + station markers + spectrograms; key fusion input (8.1).
* Tsunami — NWS/NTWC (`tsunami.gov`) `T1` `[VERIFY]` — Pacific tsunami alerts/messages for the BC coast.
* USGS "Did You Feel It" `T3` `[VERIFY]` — crowdsourced shaking intensity (aggregate).
* GNSS ground deformation — EarthScope/UNAVCO `T3` `[VERIFY]` — Cascadia subduction strain (slow signal, fascinating).
* Tsunami inundation zones / landslide susceptibility `T3` `[VERIFY]` — provincial hazard layers (static overlays).

### ✦ SPACE WEATHER

* NOAA SWPC JSON `T1` `[VERIFIED 2026-06]` — free, no key, `services.swpc.noaa.gov/json/...`: planetary K-index, solar wind (DSCOVR), GOES X-ray (flares), OVATION aurora grid (`ovation_aurora_latest.json`), alerts/watches. Derive aurora-over-Island (8.7). → oval overlay + gauges.
* NASA DONKI `T2` `[VERIFY]` — flares, CMEs, geomagnetic storms (`api.nasa.gov`, free key).

### ✈ SKIES (AIR)

* OpenSky Network `T1` `[VERIFIED 2026-06 — auth changed]` — live aircraft state vectors; `GET /api/states/all` with bbox = VI box. As of 2026-03-18 OAuth2 client-credentials required (basic auth removed): POST `https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token` (`grant_type=client_credentials`, `client_id`/`client_secret`), ~30-min tokens → cache+refresh. Anonymous = heavily rate-limited, most-recent-only. → oriented `IconLayer` + `TripsLayer`.
* MIL mode `T2` `[VERIFY]` — tag military hex ranges, AWACS/tankers/P-8s, 442 Sqn Cormorants (CFB Comox), water bombers in fire season.
* adsb.fi / adsb.lol / ADSB.One `T2` `[VERIFY]` — free community ADS-B REST (no key); supplement/fallback.
* ADS-B Exchange / FlightAware `T2` `[VERIFY]` — registration, photos, route history for the INSPECTOR.
* NAV CANADA NOTAMs / TFRs `T3` `[VERIFY]` — flight restrictions (incl. fire TFRs).
* YYJ arrivals/departures + air-ambulance/Helijet `T3` `[VERIFY]` — schedule board + medevac context.

### ⚓ SEAS (MARINE)

* aisstream.io `T1` `[VERIFIED 2026-06]` — free WebSocket AIS (`wss://stream.aisstream.io/v0/stream`), bbox = Salish Sea/Juan de Fuca, MMSI/type filters, free key. Needs an ingestion worker (§5.2). → oriented vessel icons, type-colored, click → identity/voyage + trail; AIS-gap anomaly (8.5).
* BC Ferries `T1` `[VERIFY]` — real-time sailing status + (community) vessel positions; Island-specific movement + terminal context.
* Tides/water levels — DFO CHS `T1` `[VERIFY]` (+ NOAA CO-OPS nearby) — predictions + observed at Island stations. → readings/charts + markers.
* Marine buoys — ECCC marine + NOAA NDBC `T1` `[VERIFY]` — waves/swell/SST/wind at buoys near the Island.
* Vessel port-calls / ETA / cargo / draught `T2` `[VERIFY]` — voyage intelligence (from AIS-derived sources).
* OpenSanctions `T2` `[VERIFY]` — cross-ref vessels/operators against sanctions lists (free dataset/API); fusion flag (8.1).
* DFO fishing closures + HAB / shellfish-closure maps `T2` `[VERIFY]` — very VI; closures as overlays.
* ECHO whale vessel-slowdown zones `T3` `[VERIFY]` — voluntary slowdown areas (Haro Strait/Boundary Pass).
* SAR incidents — JRCC Victoria `T3` `[VERIFY]` — maritime search-and-rescue context where published.
* Nautical charts / bathymetry `T3` `[VERIFY]` — basemap layer for marine context.
* TeleGeography submarine-cable map `T3` `[VERIFY]` — cables landing near the Island (infrastructure awareness).

### 🛣 GROUND (MOBILITY) — incl. LIVE BUSES + TRAFFIC CAMS

* DriveBC Open511 `T1` `[VERIFIED 2026-06]` — road events: incidents, construction, closures, weather. `https://api.open511.gov.bc.ca/events` (JSON), `area_id` to Island districts, OGL-BC. → severity-coded markers + list.
* DriveBC HighwayCams `T1` `[VERIFIED 2026-06]` — open CSV: name, lat/long, highway, orientation, refresh-seconds, id, image URL; OGL-BC (`catalogue.data.gov.bc.ca/dataset/bc-highwaycams`). Gotcha: image URLs changed (2026-03) → `https://www.drivebc.ca/images/xxx.jpg` (confirm). Refreshing JPEG snapshots → `<LiveMedia kind="snapshot">`. Attribute "DriveBC / Province of B.C."
* BC Transit Open Data — GTFS + GTFS-Realtime `T1` `[VERIFIED 2026-06]` — static schedules + realtime vehicle positions / trip updates / service alerts for Victoria, Nanaimo, Cowichan, Comox, etc. (`bctransit.com/open-data`). → live bus icons + ETAs + delays + alerts.
* BC Hydro outages `T1` `[VERIFY]` — public outage map JSON feed (confirm endpoint). → outage points/polygons + affected counts.
* Live traffic flow (optional) `T2` `[VERIFY]` — TomTom Traffic Flow / HERE Traffic (keyed) congestion layer, or Mapbox traffic style if using Mapbox basemap.

### 📡 SIGNALS (RF / SIGINT)

* LiveATC.net `T2` `[VERIFY]` — embed YYJ / Comox tower audio in-platform (`<LiveMedia kind="audio">`). Listen to the sky.
* APRS — aprs.fi `T2` `[VERIFY]` — live amateur position beacons: balloons, trackers, weather stations, vehicles. → moving markers.
* SondeHub / radiosondy.info `T2` `[VERIFY]` — track regional weather balloons ascending/drifting/falling. Great moving target + trail.
* GPSJam `T2` `[VERIFY]` — daily ADS-B-derived GPS interference/spoofing map. → choropleth overlay; pure intel flavor.
* SatNOGS / WebSDR / KiwiSDR `T3` `[VERIFY]` — satellite ground-station network; in-browser HF spectrum from nearby receivers (audio embed where sanctioned).
* Self-hosted SDR (optional) `T3` — RTL-SDR + `dump1090` → own ADS-B radar; SDR AIS receiver → local vessels. Receive-only, unencrypted only (§5.6).
* Broadcastify / RadioReference `T3` `[VERIFY]` — scanner audio only where unencrypted. Honest note: most BC public-safety radio is encrypted → thin here. Don't decode/retransmit encrypted.

### 🛰 INFRASTRUCTURE / NETWORK / CYBER

* Cloudflare Radar `T2` `[VERIFY]` — regional internet traffic, attacks, outages — "cyber weather." → metrics + status.
* NetBlocks `T3` `[VERIFY]` — internet shutdowns (world mode).
* RIPEstat `T3` `[VERIFY]` — BGP anomalies/routing.
* OpenCelliD `T3` `[VERIFY]` — cell towers + coverage layer.
* BC Hydro grid load + transmission lines `T2` `[VERIFY]` — system load readings + line geometry; anomaly baseline (8.5).
* Open Charge Map `T2` `[VERIFY]` — EV-charger locations + live availability.
* Snowpack / SWE automated stations `T2` `[VERIFY]` — freshet + drought signal (BC ASWS / snow pillows).
* Reservoir / dam levels `T3` `[VERIFY]` — BC Hydro reservoir/dam data.
* Municipal building-permit / rezoning open data `T3` `[VERIFY]` — "what's being built" (Victoria/Nanaimo/CRD).

### 🌲 WILDFIRE (own cluster — emphasized)

* BC Wildfire Service — current fires `T1` `[VERIFIED 2026-06]` — active perimeters (polygons) + active fire points + fire bans/restrictions, via ArcGIS ESRI REST + WMS on `openmaps.gov.bc.ca` (`WHSE_LAND_AND_NATURAL_RESOURCE.PROT_CURRENT_FIRE_POLYS_SP`), ~15-min refresh, OGL-BC. → perimeters `GeoJsonLayer`, fires sized by hectares, bans overlay.
* CWFIS (NRCan) `T1` `[VERIFIED 2026-06]` — `cwfis.cfs.nrcan.gc.ca/datamart`: hotspots (M3 MODIS/VIIRS), Fire Danger Rating, Fire Weather Index, Fire Behaviour Prediction, smoke/AQ. → danger choropleth + hotspots.
* NASA FIRMS `T1` `[VERIFY]` — MODIS/VIIRS active-fire hotspots, free MAP_KEY, area CSV/JSON by bbox (`firms.modaps.eosdis.nasa.gov/api/area/...`) — satellite cross-check.
* Smoke — FireSmoke.ca / BlueSky Canada (+ NOAA surface smoke) `T2` `[VERIFY]` — animated plume layer; fusion input for "smoke ETA" (8.1).
* Reference impl: NBFireMap (GitHub) fuses CWFIS perimeters + FIRMS + NOAA smoke + FDR/FWI/FBP + AQHI + Sentinel-2 + OpenSky ADS-B (water bombers) — mirror its HAZARD/wildfire layer model.

### 🌍 ENVIRONMENT & CONDITIONS

* Air quality — BC AQHI + AQHI+ (smoke) `T1` `[VERIFIED 2026-06]` (`gov.bc.ca` / `weather.gc.ca`) + PurpleAir API `[VERIFIED 2026-06]` (community PM2.5, free key, `api.purpleair.com`, dense Island coverage) + OpenAQ. → AQHI station markers + fine PM2.5 layer; AQHI-spike anomaly (8.5).
* Drought — BC Drought Portal / Canadian Drought Monitor `T2` `[VERIFY]` — Island drought level overlay + status.
* Streamflow/hydrometric — ECCC (+ BC River Forecast Centre) `T2` `[VERIFY]` — live levels/flow on Island rivers + flood watches.
* SST / chlorophyll / algal blooms `T2` `[VERIFY]` — NOAA/Sentinel ocean-color; ONC ocean acidification. → coastal layers.
* Astronomy `T2` `[VERIFY]` — `sunrise-sunset.org` (free), moon phase, ISS passes (`wheretheiss.at`/Open Notify), satellite passes (N2YO, keyed). → day/night terminator + ISS track.
* UV index / pollen / king tides + storm surge / glacier change / fuel-moisture `T3` `[VERIFY]` — seasonal condition layers.
* Earth imagery (overkill basemap) `T3` `[VERIFY]` — NASA GIBS/Worldview + Sentinel-2 (Living Atlas / Sentinel Hub): true-color/thermal/smoke overlays.

### ✨ SPACE (objects)

* Satellite tracking — CelesTrak / N2YO (public TLEs) `T2` `[VERIFY]` — ISS, Starlink trains, public observation satellites, reentries; propagate TLEs (8.7) → ground tracks + pass predictions. Public TLEs only.
* Rocket launches — Launch Library 2 `T3` `[VERIFY]` — upcoming/active launches (world board).
* NASA NEO / asteroids `T3` `[VERIFY]` — near-Earth object feed (`api.nasa.gov`).
* All-sky aurora cams + light-pollution layer `T3` `[VERIFY]` — aurora cams (audio/iframe) + dark-sky overlay.

### 📣 PULSE — CIVIC / HUMAN TERRAIN (aggregate, ethical)

* Local news RSS `T1` `[VERIFY each]` — Times Colonist, CHEK News, CTV Vancouver Island, Capital Daily, Black Press (Victoria/Saanich/Oak Bay News, Nanaimo News Bulletin, Comox Valley Record), CBC BC. Aggregate + dedupe + geocode; summaries in-platform.
* Google News RSS (region-scoped) `T1` `[VERIFY]` — catch-all by "Vancouver Island" + municipality names.
* GDELT `T2` `[VERIFY]` — global event/news/tone database, geo + theme filterable; Island filter for PULSE, global for WORLD.
* Events — Ticketmaster Discovery + Eventbrite (keyed) `T2` `[VERIFY]` + municipal calendars, Tourism Victoria, UVic events. → map pins + agenda.
* Civic / emergency advisories `T2` `[VERIFY]` — EmergencyInfoBC, CRD advisories, boil-water/drought notices, Service BC / school-closure / court-schedule feeds.
* Public alerts (AMBER + emergency) — Alert Ready / NAAD `T1` `[VERIFIED 2026-06]` — Canada's national system (Pelmorex), CAP-CP XML; covers AMBER + weather/civil emergencies. Ingest via NAAD streaming socket or HTTP archive (`*.naad-adna.pelmorex.com`); filter CAP geocodes to the Island. → prominent banner + map polygon + toast + alerting pipeline (8.8).
* WildSafeBC bear/cougar sightings `T2` `[VERIFY]` — peak-VI wildlife encounters. → sighting layer.
* BCCDC wastewater surveillance `T3` `[VERIFY]` — public-health signal (aggregate, anonymous).
* Aggregate social — Bluesky/Mastodon firehose + Reddit `T3` `[VERIFY]` — geo/keyword-filtered regional chatter (`r/VancouverIsland`, `r/VictoriaBC`, `r/NanaimoBC`). Aggregate sentiment/headlines only — never track or de-anonymize individuals.
* Crime / incidents `T3` `[VERIFY]` — Victoria PD/Saanich PD open data where it exists; RCMP detachment news; StatsCan (not real-time). Canadian real-time crime is limited; aggregate responsibly; no doxxing.
* Google Trends (regional) / Wikipedia recent-changes (local pages) `T3` `[VERIFY]` — interest + edit-activity signals.
* Real-estate listing velocity + new developments `T3` `[VERIFY]` — market pulse; StatsCan demographics as context layers.

### 🌐 WORLD MODE (global — for the WORLD page + world-mode fusion)

* OpenSanctions `T2` `[VERIFY]` — sanctioned entities/vessels/people (public lists).
* ACLED `T3` `[VERIFY]` — armed-conflict events (geo).
* HealthMap / ProMED / WHO `T3` `[VERIFY]` — disease outbreaks.
* Global Affairs Canada travel advisories `T3` `[VERIFY]` — country risk.
* abuse.ch (URLhaus/ThreatFox) feeds `T3` `[VERIFY]` — cyber-threat indicators (world cyber-weather).
* (GDELT, NetBlocks, Launch Library, satellite reentries above also feed WORLD.)

## 11. Verified gotchas (don't regress to stale training data)

* OpenSky now requires OAuth2 client-credentials (since 2026-03-18); basic auth gone. Cache the ~30-min token.
* Convex actions cannot use `ctx.db` — go through `ctx.runQuery`/`ctx.runMutation`; `"use node";` for Node libs; crons static in `crons.ts`.
* aisstream + any self-hosted SDR are persistent connections → separate worker, not a Convex cron/action.
* DriveBC cam image URLs changed (2026-03) → `https://www.drivebc.ca/images/xxx.jpg` (verify).
* Windy Webcams (if used for blanket cam coverage) — image URLs expire (10 min free), require attribution; refetch metadata on load; each display = one API request.
* Mind the Convex free-tier budget — stagger cadences; roll off old `tracks`/`readings`/`notifications`.
* CORS: assume browsers can't fetch most sources directly → fetch server-side in Convex actions (also keeps keys safe).
* Encrypted radio / private cams are off-limits (§6, §12).

## 12. Design spec — the Palantir bar (graded)

**Mood:** dark, dense, precise, expensive, operational. Mission-control × financial terminal × cartographic intelligence. Restraint over flash. Color carries meaning (status), not decoration.

**Surfaces** (elevation tiers): `#0A0C10` (app bg) → `#0D1117` → `#14181F` → `#1B2129` (panels/cards). Hairline borders `rgba(255,255,255,0.06–0.10)`. Text: primary `#E6EAF0`, secondary `#9AA4B2`, tertiary `#5B6573`.

**Semantic accents** (sparingly): signal/live = cyan-blue `#38BDF8`/`#3B82F6`; nominal/ok = `#34D399`; watch/warning = amber `#F59E0B`; critical/alert = `#EF4444`; track/intel = violet `#A78BFA`. Mostly greyscale; an accent means something.

**Type:** Inter for UI/labels; a monospace (JetBrains Mono / Geist Mono / IBM Plex Mono) for all data readouts — coordinates, timestamps, IDs, metrics, counts. Small (11–13px data), generous line-height, tabular-nums for changing numbers; UPPERCASE micro-labels with letter-spacing (`LIVE FEED`, `SEISMIC`, `SECTOR 7`, `THREAT: ELEVATED`).

**Layout:** console grid — top status bar (live UTC + local clock, system health, regional threat level, active-alert count, ⌘K), left nav + layer rail (toggles with live counts + freshness), center map, right inspector, bottom timeline/scrubber + event ticker. Hairline dividers; strict 4/8px rhythm; density over whitespace (never cramped); collapsible/resizable panels.

**Map:** custom desaturated dark MapLibre style — muted land, near-black water, low-contrast roads, restrained labels; optional faint graticule + vignette; data layers pop via accents + subtle glow; deck.gl layers (§5); new/critical events get a brief expanding-ring pulse; 3D/globe for world + line-of-sight.

**Components:** stat tiles + sparklines; live event ticker; entity inspector cards + pattern-of-life; layer toggles w/ counts + freshness; status pills; mini-charts (Recharts); ⌘K palette (jump to layer/place/entity/incident); toast/alert + TTS for criticals; "updated Xs ago" chips; per-feed connection/health dots; the ANALYST INTSUM card; the INCIDENTS workspace; the SYSTEM ops board; WALL kiosk big-board.

**Motion (Framer Motion)** — purposeful, fast, mechanical: panel slide/expand 180–260ms custom ease; map fly-to on selection; count-up on changing stats; subtle pulse on live dots + new markers; layer fade-in; staggered list entrance; skeleton shimmer on load; scrubber scrub-to-replay. Nothing bouncy. Honor `prefers-reduced-motion`.

**Details that sell it:** live monospace coordinate + UTC readout; crosshair/reticle on hover with live lat/long; faint scanline/noise on panels (subtle); a short boot sequence on first load ("ESTABLISHING UPLINK… SYNCING 47 FEEDS… BLINDSPOT ONLINE"); keyboard-driven everything; persistent `SYSTEM NOMINAL / N ALERTS` status line.

## 13. Guardrails (firm, content-neutral)

BlindSpot points at public assets, infrastructure, environment, and aggregate civic signal — ships, planes, satellites, fires, weather, grids, sensors, news, public alerts. That is what makes it legitimate OSINT, and it's content-neutral: every capability in §8 (fusion, geofencing, anomaly detection, AI analyst, world mode) makes it feel more intelligence-grade while staying clean.

* **No private-individual tracking.** No facial recognition, no civilian license-plate tracking, no de-anonymizing or building dossiers on private persons, no scraping personal accounts. Watchlists/geofences apply to public assets (vessels, aircraft, infrastructure) only. Social/news/wastewater/crime feeds are aggregate signal, never individual surveillance.
* **Cameras & radio:** public/sanctioned only; never unsecured/private cams; never decode/retransmit encrypted radio (§6).
* **Licensing + attribution:** honor each source's ToS + attribution (DriveBC/Province of B.C., Windy, FIRMS, CWFIS, OpenSky, ONC, ECCC/MSC, BC Transit, NAAD, GDELT…). Keep the app private re: rebroadcast-restricted imagery (§5.3). Show the not-for-life-safety disclaimer.
* **Secrets in Convex env only;** zero in the client bundle (grep the build). Domain-restrict any client map token. AI runs server-side; the NL console is read-only over the data.
* **Rate-limit politeness:** stagger crons, cache tokens, back off on 429s, never hammer; respect each source's quota.
* **Graceful degradation:** a down/slow source shows last-known + a stale flag + its health on SYSTEM — never crashes the board, never fabricates data.

## 14. Acceptance criteria (definition of done)

* [ ] Live BlindSpot on Vercel; Convex prod with crons running; (AIS/SDR workers live if chosen); PWA installable with push.
* [ ] Clean public GitHub repo: `README` (architecture, full source list + attributions, env-var table, dev + deploy) + `RUNBOOK.md` + `SOURCES.md` + `ARCHITECTURE.md` + `PLAN.md` + `DECISIONS.md` + `AUDIT.md`.
* [ ] All pages (§4) implemented; all Island feeds VI-filtered; WORLD page live in world mode.
* [ ] Tier-1 feeds live + visibly updating; the broader catalog substantially covered (breadth is the brief); each feed shows freshness + health on SYSTEM with provenance/confidence.
* [ ] Every cam/audio feed plays in-platform (snapshot/HLS/sanctioned-iframe/audio), reachable from the map, zero auto-redirects; camera/radio guardrail respected.
* [ ] Live bus locations + schedules (BC Transit GTFS-RT) and buoy/NOAA + tide data both live on the map.
* [ ] Wildfire cluster complete (BC Wildfire perimeters+points+bans, CWFIS hotspots/danger, FIRMS, smoke).
* [ ] Intelligence layer working: ≥1 fusion rule fires on synthetic input; geofence tripwire triggers on enter/dwell; anomaly flags (AIS-gap or AQHI-spike); time-scrubber replays history; NL analyst answers a query over the data; auto-INTSUM generates on cron; alerting delivers to a channel; an incident can be created + exported; regional threat level computes.
* [ ] Map handles thousands of markers smoothly (GPU layers); ⌘K, fly-to, inspector, 3D/globe, WALL mode all work.
* [ ] Palantir design bar met (§12); motion honors reduced-motion; responsive.
* [ ] No secrets in client bundle; attributions present; disclaimer present; private-individual guardrail honored.
* [ ] `tsc`, lint, build all green; `AUDIT.md` findings resolved.

Build it like a real all-source operator console for the Island — feeds and brain. Verify before you trust an endpoint. Keep it deployable. Make it beautiful. The name is the standard: no blind spots.
