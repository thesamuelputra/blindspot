# PLAN.md — Build plan (Phases 2–7)

> Phase 1 gate artifact, 2026-06-11. Phases run in order; each gates on its exit criteria. Sub-agent fan-out happens only where marked, against the contracts in ARCHITECTURE.md. Phase 0 (SOURCES.md, DECISIONS.md) and Phase 1 (ARCHITECTURE.md, this file) are complete.

## Keys & accounts (Samuel's queue — nothing below blocks on these until the feed that needs them)

| Key | Needed for | Tier when missing | How |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | analyst + INTSUM (Phase 4) | brain runs without AI pieces | console.anthropic.com |
| aisstream.io key | live AIS (worker) | SEAS uses BC Ferries only | GitHub sign-in at aisstream.io |
| OpenSky written agreement + client id/secret | OPTIONAL aircraft supplement | not needed — adsb.fi/adsb.lol/airplanes.live trio is the backbone | per SOURCES.md, OpenSky's 2026 ToS requires a written agreement for automated use; skip unless pursued properly |
| NASA FIRMS MAP_KEY | satellite hotspots | BCWS + CWFIS still cover fires | firms.modaps.eosdis.nasa.gov/api/area |
| PurpleAir key | PM2.5 mesh | AQHI stations still live | develop.purpleair.com (credit model — read SOURCES.md) |
| Cloudflare Radar token | cyber weather | panel shows n/a | dash.cloudflare.com API token |
| Ticketmaster Discovery | events | municipal calendars still live | developer.ticketmaster.com |
| ONC Oceans 3.0 token | seafloor sensors (fusion input) | tsunami rule degrades to quake+tide only | data.oceannetworks.ca profile |
| OpenCelliD / N2YO / OpenChargeMap | T3 layers | layers absent | respective portals |
| ntfy topic (random string) | alerting | web push only | pick one, set env |
| `OCM_KEY` | EV chargers | layer absent | openchargemap.org (free) |
| `ABUSECH_AUTH_KEY` | world cyber counts | panel n/a | abuse.ch auth portal (free) |
| `REDDIT_CLIENT_ID`/`SECRET` | aggregate social pulse | Bluesky-only attempts | reddit.com/prefs/apps (script app, free) |
| Fly.io (or alt) account | AIS worker hosting (~$2/mo) | AIS off; graceful | fly.io — **Samuel's call per DECISIONS D2** |

## Phase 2 — Foundation (serial, orchestrator)

1. Scaffold: Vite 8 + React + TS strict; TanStack Router; Convex (`schema.ts` from ARCHITECTURE §3, auth, empty crons); zustand; `motion`; tokens.css (BRIEF §12 palette/type); ESLint+Prettier.
2. App shell: top status bar (UTC+local clocks, threat placeholder, alert count, ⌘K stub), left nav, page scaffolds for all 15 routes, INSPECTOR overlay shell, footer disclaimer + attribution slot.
3. Map core: MapLibre 5 + forked desaturated OpenFreeMap dark style (`basemap/`), deck.gl 9.3 `MapboxOverlay` interleaved, hover reticle with live lat/lng/UTC readout, fly-to util, layer rail wired to an (empty) registry.
4. Auth: Convex Auth Password provider, login screen (operator aesthetic), route guard.
5. Deploy: Convex dev→prod project, Vercel project with SPA rewrite + `npx convex deploy --cmd 'npm run build'`, `CONVEX_DEPLOY_KEY`. **Exit: authenticated hello-console with live map on Vercel; tree green.**

## Phase 3 — Ingestion + layers (sub-agent waves; orchestrator integrates per wave)

Module contract: ARCHITECTURE §5. One sub-agent per feed; inputs = SOURCES.md entry + schema + registry interface; outputs = `convex/feeds/<slug>.ts`, cron registration (orchestrator merges `crons.ts`), layer/panel entry, SOURCES.md correction if reality diverged. Serialize all `crons.ts`/`schema.ts`/registry merges through the orchestrator.

**Wave A — hazard core (T1):** eccc weather-alerts, GeoMet rasters (client: radar + GOES-West satellite + lightning-density), usgs-quakes + nrcan-quakes, pnsn-tremor, ntwc-tsunami, naad-pelmorex (CAP poll, VI SGC filter), bcws fires (polys+points+bans), bc-evac-orders, cwfis hotspots+danger, **nasa-firms** (keyless Canada CSV per SOURCES.md), **smoke layer** (GeoMet RAQDPS/FireWork per SOURCES.md wildfire notes), bchydro-outages, drivebc open511.
**Wave B — movers + stations (T1):** **aircraft backbone: adsb.fi + adsb.lol + airplanes.live behind one readsb-shape adapter with failover** (OpenSky optional later, gated on written agreement — see keys table), bc-transit GTFS-RT (vehicles/trips/alerts per Island system; protobuf via `gtfs-realtime-bindings` in `"use node"`, static GTFS via build-time script per ARCHITECTURE §5.8), bc-ferries, dfo-chs tides, ndbc + ECCC buoys, **onc-oceans3** (token — feeds the tsunami fusion rule), **eccc-conditions** (citypage + swob), **open-meteo**, uvic-weather-mesh (curated subset), aqhi, hydrometric + **bc-rfc-advisories**, swpc space-weather set (kp, solar wind, xray, ovation, scales), drivebc highwaycams + cameras table seed.
**Wave C — breadth (T2/T3):** marine text forecasts, lightstations, ccg-notship, dfo closures, opensanctions dataset, sondehub, aprs (worker-or-poll per SOURCES.md), gpsjam, cloudflare radar, ripestat, bc snow, reservoirs?, open charge map, permits, purpleair, openaq, drought, sst-erddap, gibs, celestrak+satellite.js passes, launch-library, nasa-neo, news RSS set (each outlet), google news, gdelt (VI+world), bc-parks-advisories, emergencyinfobc, bccdc wastewater, reddit/bluesky aggregate, events, world-mode set (gdacs, who, gac, abusech, ioda, acled?), orcasound feeds + remaining cams (YouTube live set, Mt Washington, ferry terminal cams).
**Wave D — AIS worker:** `workers/ais` + httpAction + vessel layer + trails (can start once Samuel has the aisstream key; everything else proceeds without it).

**Exit:** Tier-1 feeds visibly updating on the map with health on SYSTEM; `npx convex run feeds/<slug>:sync` clean for every module; no red tree at any commit.

## Phase 4 — The brain (mixed: contracts serial, modules parallel)

Order: (1) brain tick skeleton + derived-signal plumbing + batched context query/commit mutation; (2) fusion rules (5 seed rules, synthetic fixtures); (3) geofences + states + draw UI; (4) baselines + anomaly (incl. health-gated AIS-gap); (5) alerting pipeline (edge-triggered; ntfy + web push + TTS + ack); (6) threat compute + SYSTEM board; (7) analyst action + ANALYST page; (8) INTSUM cron + COMMAND card; (9) incidents CRUD (child tables) + export; (10) scrubber/replay (bounded history queries + TripsLayer rebased time); (11) geo-analytics + predictive overlays per ARCHITECTURE §7.9 (rings, viewshed/DEM, KDE, fire cone, smoke ETA, aurora, passes, dead-reckoning — verify terrarium DEM tiles and record in SOURCES.md); (12) watchlist CRUD/UI + pattern-of-life cron per §7.10. Stretch: one world-mode fusion rule (GDACS + GDELT co-location) to honor BRIEF §8.9. 2–6 and 7–12 can run as two parallel tracks after 1 lands.

**Exit = BRIEF acceptance bullets:** rule fires on synthetic input; fence triggers; anomaly flags; scrubber replays; analyst answers; INTSUM generates; alert delivers; incident exports; threat computes.

## Phase 5 — Command-center UI (parallelizable by page after shell freeze)

COMMAND (master map + tiles + ticker + INTSUM card), HAZARD/SKIES-SEAS/GROUND/SIGNALS/INFRASTRUCTURE/PULSE/ENVIRONMENT/SPACE (cluster pages over the registry), CAMS (wall grid + map, all `<LiveMedia>`), ANALYST, INCIDENTS, WORLD (globe + world registry), SYSTEM (ops board), WALL (kiosk rotation); ⌘K palette; boot sequence; PWA (`vite-plugin-pwa`) + push opt-in; `prefers-reduced-motion`; responsive pass. Flagships get the polish budget: ANALYST, INCIDENTS, CAMS, SYSTEM.

## Phase 6 — Verify (parallel audits → AUDIT.md → fix cycle)

`tsc --noEmit`, ESLint, prod build, bundle secret-grep; per-feed smoke (data fresh, VI-filtered, layer renders, attribution present); capability checklist (Phase 4 exits re-run); perf (synthetic 5k markers); empty/loading/error states; keyboard + reduced-motion; PWA install + push; mobile. All findings logged in AUDIT.md and resolved or explicitly waived with rationale.

## Phase 7 — Deploy & docs

README (architecture diagram, full source/attribution table generated from SOURCES.md, env-var table, dev+deploy), RUNBOOK.md (crons, worker, keys, notification setup, recovery), GitHub push (public), Vercel prod + Convex prod env + crons live, worker deploy (pending D2 hosting call), end-to-end confirmation: live ingestion → fusion alert → INTSUM → push notification.

## Standing risks

- **Convex budget drift** — watch function-call usage AND db-bandwidth after Wave B; cadence tuning + snapshot subscriptions are the levers (D8, ARCHITECTURE §11). Bandwidth overrun on a card-less plan stops mutations, not just costs cents.
- **Source flakiness** — health ladder + SOURCES.md updates are part of every fix; never fabricate.
- **Auth lib is pre-1.0** — pin 0.0.94; treat upgrades as deliberate events.
- **aisstream beta** — reconnect/backoff + BC Ferries fallback keep SEAS alive.
- **Scope discipline** — flagship quality (ANALYST/INCIDENTS/CAMS/SYSTEM + COMMAND map) beats long-tail T3 coverage if time pressures appear; T3 feeds are the cut line, never the brain.
