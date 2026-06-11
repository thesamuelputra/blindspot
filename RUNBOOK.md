# RUNBOOK.md — Operating BlindSpot

> For the single operator. Everything here was verified during the build (2026-06-11). Deployments: Convex dev `industrious-cow-846`, prod `trustworthy-lion-377` (team `samuel-putra`, project `blindspot`); Vercel project `blindspot` → https://blindspot-gold.vercel.app.

## First-run checklist

1. **Operator account:** open the console → "first run? register operator" → create your account. There is exactly one operator; after registering, treat further signups as policy-forbidden (wipe strays with `npx convex run admin:wipeUsers` — it clears ALL auth records, then re-register).
2. **Keys queue** (each lights up its feed on the next cron tick; see PLAN.md for signup links):
   ```bash
   npx convex env set --prod ANTHROPIC_API_KEY sk-ant-…    # analyst + INTSUM
   npx convex env set --prod NTFY_TOPIC <long-random>      # then subscribe: ntfy.sh app → same topic
   npx web-push generate-vapid-keys                        # then set VAPID_* on Convex prod,
                                                           # VITE_VAPID_PUBLIC_KEY on Vercel, redeploy
   npx convex env set --prod ONC_TOKEN … PURPLEAIR_KEY … OPENAQ_KEY … CLOUDFLARE_RADAR_TOKEN … OCM_KEY … ABUSECH_AUTH_KEY …
   ```
3. **AIS worker** (live vessels): get a free key at aisstream.io (GitHub sign-in), then:
   ```bash
   cd workers/ais && npm install
   AISSTREAM_KEY=… CONVEX_SITE_URL=https://trustworthy-lion-377.convex.site \
     INGEST_SECRET=$(npx convex env get --prod INGEST_SECRET) npm start
   ```
   Hosted: `fly launch` from `workers/ais/` (Dockerfile present, ~$2/mo shared-cpu-1x) or any always-on box. The board degrades cleanly whenever the worker is down (ferries keep estimated positions; vessels show last-known + stale).

## Routine operations

- **Health:** the SYSTEM page is the ops board. CLI mirror: `npx convex run admin:healthSummary`. `stale`/`down` rows carry the exact reason (most common: a key not configured).
- **Crons:** all defined in `convex/crons.ts` (fast lane 107–131s, medium 4–15m, slow 30m–daily, brain tick 120s, baselines hourly, INTSUM 4h, retention hourly, pattern-of-life daily). Deploying updates them; there is no manual cron management.
- **Manual sync of any feed:** `npx convex run feeds/<module>:sync` (module names = camelCase of the SOURCES.md slug).
- **Force an INTSUM:** `npx convex run brain/intsum:generate` (or the REGENERATE button on ANALYST).
- **Test the alert pipeline end-to-end:**
  ```bash
  npx convex run brain/alerting:notify '{"severity":"warning","title":"pipeline test","body":"check phone + bell","dedupeKey":"manual:test:1"}'
  ```
  Expect: in-app toast + bell count, ntfy push (if topic set), web push (if VAPID set + subscribed). Re-running inside the 15-minute warning window correctly does nothing (edge-triggered dedupe).
- **Watchlists:** star any vessel/aircraft in its inspector. Pattern-of-life profiles compute daily (`npx convex run brain/patternOfLife:computeAll` to force).
- **Fusion rule tuning:** rule thresholds live in the `rules` table as JSON params keyed by slug (`squawk-emergency`, `tsunami-correlation`, `smoke-eta`, `sanctions-match`, `ais-gap-sensitive`); rows are optional — absent = enabled with code defaults. Implementations: `convex/brain/rules/`.

## Known operational facts

- **Dev + prod both run crons.** Two deployments means double polling of upstreams and double Convex budget. When not actively developing, leave dev idle-safe by either deleting heavy crons on dev or simply accepting it (cadences are polite). Budget math: DECISIONS.md D8 (~1–1.3M calls/mo/deployment; bandwidth is the tighter ceiling — watch the Convex dashboard usage page the first weeks).
- **GDELT 429s** intermittently on shared egress IPs; the cron self-recovers. Stale-with-429 on `gdelt` is normal noise, not breakage.
- **adsb.fi/adsb.lol/airplanes.live failover** is automatic; the SYSTEM row shows which provider served last.
- **Ferries are schedule-interpolated estimates** (state.estimated=true) until the AIS worker runs — BC Ferries publishes no public position feed (verified; SOURCES.md `bc-ferries`).
- **ONC tsunami input** (seafloor pressure) joins the tsunami fusion rule automatically once `ONC_TOKEN` is set.
- **Sanctions matching** activates when an `opensanctions`-maintained MMSI list lands in the `sanctions-match` rule row params (module not yet built — see PLAN.md).
- **Retention** keeps tracks 48h, readings 7d, signals 14–30d, notifications 30d. The replay window is bound to track retention (48h max).

## Recovery

- **Feed broke after an upstream change:** check `lastError` on SYSTEM → fix the module in `convex/feeds/` → update its SOURCES.md entry in the same commit (the catalog is load-bearing documentation).
- **Map blank:** almost always the basemap fork missing — `npm run basemap` regenerates `public/basemap/blindspot-dark.json`; the client falls back to the hosted OpenFreeMap style automatically meanwhile.
- **Worker silent:** aisstream is beta (no SLA). The worker self-reconnects with backoff and recycles stale sockets; if the `aisstream` source row stays stale >15 min, restart the worker process.
- **Auth lockout:** `npx convex run admin:wipeUsers` (per-deployment), re-register.
- **Remove a bogus entity:** `npx convex run admin:deleteEntity '{"kind":"vessel","extId":"<mmsi>"}'`.

## Maintenance calendar

- **Annually (June):** Transport Canada redraws the whale slowdown/no-go zones — re-extract coordinates into `src/layers/defs/closures.ts` (procedure in the file header).
- **Per Convex/auth upgrades:** `@convex-dev/auth` is pinned pre-1.0 (0.0.94); treat upgrades as deliberate events with auth-flow retesting.
- **OpenSky:** stays demoted unless a written agreement is obtained (DECISIONS D12).
