# AUDIT.md — Phase 6 audit cycle

> 2026-06-11. Four parallel auditors (server-functional, browser, code-correctness, acceptance/guardrails) produced 21 findings over 54 passed checks. Every code finding was fixed and re-verified the same day; the remainder are operator key actions documented in RUNBOOK.md. Method: auditors only reported what they reproduced — every finding carries evidence.

## Verdict

**Code: clean.** `tsc`, ESLint, prod build, 109 unit tests green; bundle grep-clean of secrets. All §14 acceptance bullets that code can satisfy are satisfied; the open items are operator-gated keys (below).

## Blockers found → fixed

| Finding | Fix |
|---|---|
| **Infinite render cascade** on every mover page (`useSnapshot` returned a fresh parsed array per render; effect loop → "Maximum update depth exceeded" → tab hang after minutes) | Snapshot parse memoized on row identity; dead-reckoning projector moved to a fixed-interval loop over refs, fully decoupled from render cycles. Re-verified with a 30s soak: zero errors |
| **Wildfire cluster incomplete** (§14: bans, fire-danger, smoke all missing) | New `bcwsBans` feed (ArcGIS — live-verified, including catching layer-id drift to `/FeatureServer/14`), CWFIS `fdr_current` WMS raster, GeoMet FireWork smoke raster. All verified with live GetMaps |
| AI analyst + INTSUM dark | **Operator action:** set `ANTHROPIC_API_KEY` (RUNBOOK first-run) — code paths verified incl. the labeled-unavailable fallback |
| No external alert channel configured | **Operator action:** set `NTFY_TOPIC` + VAPID keys — pipeline verified end-to-end up to the channel boundary (row written, dedupe window enforced, channel fan-out env-gated) |

## Majors found → fixed

- **Map stuck at 400×300 on cold loads** (constructed while pane measured 0×0) → ResizeObserver drives `map.resize()`.
- **AIS vessels would flicker** (dirty-only batches vs snapshot replacement) → worker now ships the full non-stale roster per batch; plus a 5-min watchdog cron registers/marks the `aisstream` source so a dead worker is visible on SYSTEM.
- **Geofences had no operator UI** → fence panel + draw-on-map polygon tool + dashed violet fence layer + preview (engine and CRUD already existed and were fixture-tested).
- **Mobile broken / header collisions at ~800px** → nav collapses to a 44px code rail below 880px, top bar sheds reticle/push/LOC progressively, COMMAND tiles compact, SYSTEM table scrolls horizontally. Verified at 390×844 and 800×900.
- **Disclaimer rendered on one page only** (D3 requires every page) → moved into the nav rail, present on all routes.
- **Bluesky half of social-pulse silently dark** (HTTP 400 from datacenter egress; works residentially) → error body now surfaced; recorded as the verified expected state pending authenticated access.

## Minors found → fixed

Syndicated-news duplicates (dedupe now on normalized title), NEO duplicate rows (one row per object), Metro Vancouver outages bleeding through the bbox corner (island-side polygon clip), bright default attribution control (dark-themed, collapsed), `flyTo`/pulse-ring animation ignoring `prefers-reduced-motion` (gated), notification rows claiming `ntfy` delivery when unconfigured (channels computed from actual config), PWA manifest unavailable in dev (`devOptions`), `OPENAQ_KEY` missing from the PLAN keys table (added), SOURCES.md bans-layer id corrected.

## Operator actions outstanding (not code)

| Action | Effect when done |
|---|---|
| `ANTHROPIC_API_KEY` (dev+prod) | ANALYST console + 4-hourly INTSUM go live |
| `NTFY_TOPIC` + subscribe on phone | warning/critical alerts reach you anywhere |
| VAPID keypair (+ `VITE_VAPID_PUBLIC_KEY` at Vercel) | web push to the installed PWA |
| `ONC_TOKEN` | seafloor pressure joins the tsunami fusion rule |
| `AISSTREAM_KEY` + deploy `workers/ais` | real AIS vessels replace ferry estimates |
| Remaining keys queue (PLAN.md) | PurpleAir, OpenAQ, Cloudflare Radar, OCM, abuse.ch, Reddit |

## Accepted residual risks (explicit waivers)

- **Dev + prod both run crons** (double polling/budget) — accepted during active development; RUNBOOK documents the trade.
- **GDELT intermittent 429s** on shared egress — self-recovering; honest on SYSTEM.
- **Estimated ferry positions** until the AIS worker — flagged `estimated:true` in state and accepted by design (no public position feed exists).
- **Coarse island-side polygon** for mainland-sliver trimming — deliberately rough; only applied where bleed-through was visible (outages).
- **Synthetic audit rows** (one `audit test` notification, one `audit check` incident on dev) — age out via retention; harmless.

## What the auditors confirmed working (sample of 54 passed checks)

End-to-end alert dedupe windows; INTSUM unavailable-path exactly-once per day; retention sweep (135 rows removed live); all 15 routes rendering with real data or honest empty states; replay transport; analyst offline grace; incident creation; ⌘K keyboard flow; manifest + icons; every public Convex function auth-gated; no `ctx.db` in actions; stable dedupe keys; VI filters matching SOURCES.md; GPU layers throughout; tokens.css exactly matching §12's specified values; zero auto-redirects (the `open source ↗` anchors are the sanctioned exception); camera seeds traceable to sanctioned SOURCES entries; LiveATC/Broadcastify correctly absent.
