# BLINDSPOT // Vancouver Island

A single-operator, all-source intelligence command center for Vancouver Island, BC. It ingests 60+ live and semi-live open-source feeds — seismic, wildfire, weather, marine, aviation, transit, power, RF, space, news, public alerts — fuses and correlates them server-side, watches them with tripwires and anomaly detection, answers questions in plain language, and renders everything on a live operational map.

**Live console:** https://blindspot-gold.vercel.app (private; operator auth required)

The name is the mission: have none.

## Architecture

```
  ~60 verified public feeds ──HTTPS──▶ CONVEX (backend)          AIS WORKER (optional)
  (SOURCES.md is the catalog)         crons → fetch+normalize ◀── aisstream websocket,
                                      → upsert → reactive query    30s thinned batches,
                                                                   bearer-guarded ingest
  THE BRAIN (120s tick): fusion rules · geofence tripwires ·
  anomaly detection · threat level | INTSUM cron (Claude Haiku) |
  NL analyst (Claude Sonnet, read-only tool loop) | alerting →
  ntfy + web push + in-app toasts/TTS

  CLIENT (Vite SPA on Vercel): MapLibre 5 + deck.gl 9 over a forked
  desaturated OpenFreeMap dark style · 25+ toggleable layers ·
  dead-reckoned live movers · hover trails · click-to-inspect with
  in-platform cams (snapshot/HLS/iframe/audio) · time scrubber replay ·
  incidents workspace · ⌘K · WALL kiosk · WORLD globe · PWA + push
```

Three principles hold everything together:

1. **Normalized core.** Every feed lands in the same tables (`signals`, `entities`, `tracks`, `readings`, `alerts`, `cameras`) with provenance, confidence, and a dedupe key. The map, the brain, and the analyst never care where a signal came from.
2. **In-platform rendering, zero redirects.** Cams, hydrophones, flight tracks, alerts — everything is viewable inside BlindSpot. "Open source ↗" exists only as an explicit, secondary action.
3. **Honest degradation.** A keyed feed without its key shows `stale` with the exact reason on SYSTEM. A down worker leaves last-known positions with stale flags. Missing is shown as missing; nothing is fabricated.

## Repository map

| Path | What |
|---|---|
| `BRIEF.md` | The canonical build brief (binding spec) |
| `SOURCES.md` | The verified feed catalog — every endpoint live-checked, with auth/limits/licenses/gotchas |
| `ARCHITECTURE.md` / `PLAN.md` / `DECISIONS.md` / `AUDIT.md` | Phase-gate artifacts |
| `RUNBOOK.md` | Operations: keys, crons, worker, recovery |
| `convex/` | Backend: schema, 60+ feed modules, the brain (`convex/brain/`), crons, retention |
| `src/` | The console: map (`src/map`), layer registry (`src/layers`), pages, inspector, LiveMedia |
| `workers/ais/` | The aisstream websocket worker (Dockerfile included) |
| `scripts/fetch-basemap.mjs` | Regenerates the desaturated dark basemap fork |

## Environment variables

All secrets live in **Convex env** (`npx convex env set [--prod] NAME value`) — the client bundle carries none.

| Var | Where | Needed for | Without it |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | Convex | NL analyst + INTSUM | both report offline, cleanly |
| `NTFY_TOPIC` | Convex | phone alerts via ntfy.sh | web push / in-app only |
| `VAPID_PUBLIC_KEY` `VAPID_PRIVATE_KEY` `VAPID_SUBJECT` | Convex | web push | push silently disabled |
| `INGEST_SECRET` | Convex + worker | AIS worker auth | worker can't write |
| `AISSTREAM_KEY` | worker | live AIS vessels | ferries (estimated) only |
| `ONC_TOKEN` | Convex | seafloor sensors | tsunami rule degrades |
| `PURPLEAIR_KEY` `OPENAQ_KEY` `CLOUDFLARE_RADAR_TOKEN` `OCM_KEY` `ABUSECH_AUTH_KEY` `REDDIT_CLIENT_ID`/`SECRET` | Convex | their feeds | each shows stale w/ reason |
| `VITE_CONVEX_URL` | Vercel build | client → Convex | — (public by design) |
| `VITE_VAPID_PUBLIC_KEY` | Vercel build | push opt-in button | button hidden (public by design) |

## Development

```bash
npm install
npx convex dev          # backend (deploys functions + starts crons on dev)
npm run dev             # Vite on :5173
npm run typecheck && npm run lint && npx vitest run   # gates
```

First run: register the operator account through the login screen, then disable further signups by policy (see RUNBOOK).

## Deploy

- **Convex prod:** `npx convex deploy -y` (crons start automatically)
- **Vercel:** `vercel deploy --prod` (SPA rewrite in `vercel.json`; set `VITE_CONVEX_URL` to the prod deployment)
- **AIS worker (optional, ~$2/mo):** `workers/ais/` — any always-on host; see RUNBOOK

## Attribution & licenses

Data: Environment and Climate Change Canada (Data Servers End-use Licence), DriveBC / Province of B.C. (OGL-BC), BC Wildfire Service & BC Data Catalogue (OGL-BC), USGS, NRCan/Earthquakes Canada, PNSN (Wech 2010), NOAA (SWPC/NDBC/CO-OPS/GIBS via NASA), BC Transit Open Data, NAAD / Pelmorex, CWFIS (NRCan), NASA FIRMS, UVic Vancouver Island School-Based Weather Station Network (CC BY-NC-SA 4.0), Orcasound, community ADS-B (adsb.fi · adsb.lol · airplanes.live), aisstream.io, GDELT, GDACS, WHO, Global Affairs Canada, and the full per-source list in `SOURCES.md`. Basemap: OpenFreeMap © OpenMapTiles, data from OpenStreetMap.

**Disclaimer:** BlindSpot aggregates public OSINT for situational awareness. It is informational only and must not be used for life-safety decisions. Tracking is restricted to public assets (vessels, aircraft, infrastructure); no private-individual surveillance, ever.
