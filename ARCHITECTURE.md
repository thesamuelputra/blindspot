# ARCHITECTURE.md — BlindSpot system design

> Phase 1 gate artifact, 2026-06-11. This is the binding contract for all build phases and sub-agents: the Convex schema, normalized record shapes, the feed-module pattern, the brain contracts, and the client layer registry are owned here. Sub-agents conform; they do not redefine. Facts below (Convex semantics, limits, library versions) were verified live in Phase 0 — see DECISIONS.md and SOURCES.md.

## 1. System overview

```
                      ┌─────────────────────────────────────────────────┐
                      │                    SOURCES                      │
                      │  ~127 verified feeds (SOURCES.md): ECCC, USGS,  │
                      │  BCWS, OpenSky, aisstream, BC Transit, NAAD,    │
                      │  DriveBC, ONC, SWPC, GDELT, RSS, cams, …        │
                      └────────┬───────────────────────────┬────────────┘
                               │  HTTPS polling             │ WebSocket (AIS)
                               ▼                            ▼
   ┌───────────────────────────────────────────┐   ┌──────────────────┐
   │              CONVEX (backend)             │   │  AIS WORKER      │
   │  crons.ts ─→ internalAction (fetch +      │◀──│  Node + ws,      │
   │   normalize) ─→ internalMutation (upsert) │   │  Fly.io/any box, │
   │  schema: signals/entities/tracks/readings │   │  → httpAction    │
   │   /alerts/cameras/sources + brain tables  │   │  (shared secret) │
   │  BRAIN (90s tick): fusion · geofences ·   │   └──────────────────┘
   │   anomaly · threat │ INTSUM cron (4h) ·   │
   │   analyst action (Claude, tool-use loop)  │──→ Anthropic API
   │  alerting: web-push ("use node") + ntfy   │──→ ntfy.sh / browsers
   └────────────────────┬──────────────────────┘
                        │ reactive queries (websocket)
                        ▼
   ┌───────────────────────────────────────────┐
   │           CLIENT (Vite SPA, Vercel)       │
   │  TanStack Router pages · MapLibre 5 +     │
   │  deck.gl 9.3 (MapboxOverlay interleaved)  │
   │  layer registry · <LiveMedia> · scrubber  │
   │  ⌘K · WALL · PWA + push · Convex Auth     │
   │  Direct raster loads: GeoMet WMS (CORS *) │
   │  Direct HLS: Orcasound S3 (CORS *)        │
   └───────────────────────────────────────────┘
```

Three runtimes, one contract: everything that enters the system becomes a **normalized record** (§4) stamped with provenance; everything the brain produces is surfaced through the same record types; the client renders from reactive queries + the layer registry and never knows source quirks.

## 2. Repo layout

```
/                       Vite app root (deployed to Vercel)
  vercel.json           SPA rewrite + build cmd (npx convex deploy --cmd 'npm run build')
  index.html, src/
    main.tsx
    routes/             TanStack Router file routes (one per page, §9)
    components/         shell chrome, LiveMedia, inspector, tiles, ticker, palette…
    layers/             deck.gl layer registry (§10)
    lib/                bbox.ts (shared const), geo.ts, time.ts, format.ts
    state/              zustand store (map/UI ephemera, scrubber, layer toggles)
    styles/tokens.css   design tokens (BRIEF §12)
  convex/
    schema.ts           §3 — owned here, single source of truth
    crons.ts            static cron registry (cadence per DECISIONS D8)
    http.ts             httpAction: /ingest/ais (worker, shared secret), /health
    auth.ts             Convex Auth (Password provider, single operator)
    lib/                fetchSource.ts (timeout/backoff/304), geo.ts, health.ts, dedupe.ts
    feeds/              one file per feed module (§5): ecccAlerts.ts, usgsQuakes.ts, …
    brain/              fusion.ts, rules/, geofence.ts, anomaly.ts, threat.ts,
                        intsum.ts, analyst.ts, alerting.ts, push.ts ("use node" —
                        web-push only; a "use node" file can't host default-runtime fns)
    retention.ts        TTL/downsample crons (§11)
  workers/ais/          standalone Node worker: package.json, src/index.ts, Dockerfile
  basemap/              forked + desaturated OpenFreeMap dark style JSON
  BRIEF.md SOURCES.md DECISIONS.md ARCHITECTURE.md PLAN.md (+ AUDIT.md, RUNBOOK.md later)
```

## 3. Convex schema (owned; sub-agents do not modify without orchestrator sign-off)

```ts
// convex/schema.ts — sketch at contract level; exact validators land in Phase 2
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

const severity = v.union(v.literal("info"), v.literal("watch"), v.literal("warning"), v.literal("critical"));

export default defineSchema({
  ...authTables,

  // ---- registry & health ----
  sources: defineTable({
    slug: v.string(),              // = SOURCES.md id, e.g. "usgs-quakes"
    name: v.string(),
    cluster: v.string(),
    status: v.union(v.literal("live"), v.literal("stale"), v.literal("down"), v.literal("disabled")),
    cadenceSec: v.number(),
    lastSyncAt: v.optional(v.number()),
    lastSuccessAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    consecutiveFailures: v.number(),
    lastCount: v.optional(v.number()),   // records seen last sync
    attribution: v.string(),
    licenseNote: v.optional(v.string()),
  }).index("by_slug", ["slug"]).index("by_cluster", ["cluster"]),

  // ---- normalized core ----
  signals: defineTable({
    sourceSlug: v.string(),
    kind: v.string(),              // SignalKind (§4)
    title: v.string(),
    summary: v.optional(v.string()),
    severity,
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
    cell: v.optional(v.string()),  // "48.4,-123.4" 0.2° bucket, for proximity scans
    geojson: v.optional(v.string()),// stringified geometry for polygons/lines
    startsAt: v.optional(v.number()),
    observedAt: v.number(),
    expiresAt: v.optional(v.number()),
    dedupeKey: v.string(),
    confidence: v.number(),        // 0..1 (§4)
    provenance: v.string(),        // JSON: {method, fetchedAt, upstreamId, url?}
    raw: v.optional(v.string()),   // trimmed upstream record (JSON), size-capped
    derivedFrom: v.optional(v.array(v.id("signals"))), // set on kind="derived"
    rationale: v.optional(v.string()),                 // set on kind="derived"
  })
    .index("by_dedupe", ["dedupeKey"])
    .index("by_kind_observed", ["kind", "observedAt"])
    .index("by_observed", ["observedAt"])
    .index("by_source_observed", ["sourceSlug", "observedAt"])
    .index("by_cell", ["cell", "observedAt"]),

  entities: defineTable({
    kind: v.string(),              // aircraft | vessel | bus | ferry | station | camera | fire | satellite | balloon | aprs
    extId: v.string(),             // icao24 | mmsi | gtfs vehicle id | station id | norad id …
    label: v.string(),
    sourceSlug: v.string(),
    lat: v.number(),
    lng: v.number(),
    heading: v.optional(v.number()),
    speed: v.optional(v.number()),
    altitude: v.optional(v.number()),
    state: v.optional(v.string()), // JSON: kind-specific (squawk, callsign, shipType, route…)
    firstSeenAt: v.number(),
    lastSeenAt: v.number(),
    stale: v.boolean(),
    watch: v.boolean(),            // watchlist elevation (denormalized for query speed)
  })
    .index("by_kind", ["kind", "lastSeenAt"])
    .index("by_ext", ["kind", "extId"])
    .index("by_watch", ["watch", "lastSeenAt"]),

  tracks: defineTable({
    entityId: v.id("entities"),
    at: v.number(),
    lat: v.number(),
    lng: v.number(),
    heading: v.optional(v.number()),
    speed: v.optional(v.number()),
    altitude: v.optional(v.number()),
  }).index("by_entity_at", ["entityId", "at"]).index("by_at", ["at"]),

  readings: defineTable({
    stationId: v.string(),         // "<sourceSlug>:<upstream station id>"
    metric: v.string(),            // Metric (§4): air_temp, aqhi, water_level, kp, hectares…
    value: v.number(),
    unit: v.string(),
    at: v.number(),
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
    sourceSlug: v.string(),
  }).index("by_station_metric_at", ["stationId", "metric", "at"]).index("by_metric_at", ["metric", "at"]).index("by_at", ["at"]),

  alerts: defineTable({            // CAP-grade alerting products (NAAD, ECCC, tsunami, evac orders)
    sourceSlug: v.string(),
    capId: v.string(),             // upstream identifier — dedupe key
    headline: v.string(),
    description: v.optional(v.string()),
    severity,
    urgency: v.optional(v.string()),
    certainty: v.optional(v.string()),
    area: v.optional(v.string()),  // stringified GeoJSON
    effective: v.number(),
    expires: v.optional(v.number()),
    status: v.union(v.literal("active"), v.literal("expired"), v.literal("cancelled")),
  }).index("by_cap", ["capId"]).index("by_status", ["status", "effective"]),

  cameras: defineTable({
    slug: v.string(),
    name: v.string(),
    lat: v.number(),
    lng: v.number(),
    kind: v.union(v.literal("snapshot"), v.literal("hls"), v.literal("iframe"), v.literal("audio")),
    mediaUrl: v.string(),
    refreshSec: v.optional(v.number()),
    orientation: v.optional(v.number()),
    sourceSlug: v.string(),
    attribution: v.string(),
    active: v.boolean(),
  }).index("by_slug", ["slug"]).index("by_kind", ["kind"]),

  // ---- the brain ----
  geofences: defineTable({
    name: v.string(),
    geojson: v.string(),
    rule: v.union(v.literal("enter"), v.literal("exit"), v.literal("dwell")),
    dwellSec: v.optional(v.number()),
    entityKinds: v.array(v.string()),
    severity,
    active: v.boolean(),
    auto: v.optional(v.string()),  // set when auto-generated, e.g. "fire:<signalId>"
  }).index("by_active", ["active"]),

  geofenceStates: defineTable({    // per (fence, entity) dwell bookkeeping
    fenceId: v.id("geofences"),
    entityId: v.id("entities"),
    insideSince: v.optional(v.number()),
    lastInside: v.boolean(),
    lastFiredAt: v.optional(v.number()),
  }).index("by_fence_entity", ["fenceId", "entityId"]),

  watchlist: defineTable({
    kind: v.string(),              // vessel | aircraft | infrastructure
    identifier: v.string(),        // mmsi | hex | slug
    label: v.string(),
    notes: v.optional(v.string()),
    active: v.boolean(),
    pattern: v.optional(v.string()), // rolling pattern-of-life JSON (§7.10), refreshed daily
  }).index("by_active", ["active"]).index("by_ident", ["kind", "identifier"]),

  rules: defineTable({             // fusion rule CONFIG; implementations live in code (§7.1)
    slug: v.string(),              // must match a key in brain/rules registry
    name: v.string(),
    params: v.string(),            // JSON, rule-specific thresholds
    severity,
    active: v.boolean(),
    lastFiredAt: v.optional(v.number()),
  }).index("by_slug", ["slug"]).index("by_active", ["active"]),

  baselines: defineTable({
    metric: v.string(),            // e.g. "count:aircraft", "reading:aqhi:victoria", "rate:quakes"
    windowHours: v.number(),
    mean: v.number(),
    stddev: v.number(),
    p95: v.number(),
    n: v.number(),
    updatedAt: v.number(),
  }).index("by_metric", ["metric"]),

  incidents: defineTable({
    title: v.string(),
    status: v.union(v.literal("open"), v.literal("monitoring"), v.literal("closed")),
    createdAt: v.number(),
    annotations: v.optional(v.string()), // GeoJSON FeatureCollection (drawings)
  }).index("by_status", ["status", "createdAt"]),

  // child tables — never unbounded arrays on the incident doc (8,192-element / 1 MiB caps)
  incidentSignals: defineTable({
    incidentId: v.id("incidents"),
    signalId: v.id("signals"),
    addedAt: v.number(),
  }).index("by_incident", ["incidentId"]).index("by_signal", ["signalId"]),

  incidentEvents: defineTable({
    incidentId: v.id("incidents"),
    at: v.number(),
    text: v.string(),
    auto: v.boolean(),
  }).index("by_incident_at", ["incidentId", "at"]),

  notifications: defineTable({
    at: v.number(),
    severity,
    title: v.string(),
    body: v.string(),
    channels: v.array(v.string()),
    dedupeKey: v.string(),
    ack: v.boolean(),
    signalId: v.optional(v.id("signals")),
  }).index("by_dedupe", ["dedupeKey", "at"]).index("by_at", ["at"]).index("by_ack", ["ack", "at"]),

  threat: defineTable({            // rolling computations, keep last ~96 (24h at 15min)
    computedAt: v.number(),
    level: v.union(v.literal("NOMINAL"), v.literal("ELEVATED"), v.literal("HIGH")),
    score: v.number(),
    factors: v.string(),           // JSON [{label, weight, signalId?}]
  }).index("by_at", ["computedAt"]),

  intsums: defineTable({
    at: v.number(),
    text: v.string(),
    model: v.string(),
    snapshot: v.optional(v.string()), // JSON of the stats fed to the model
  }).index("by_at", ["at"]),

  pushSubscriptions: defineTable({
    endpoint: v.string(),
    keys: v.string(),              // JSON {p256dh, auth}
    createdAt: v.number(),
    lastOkAt: v.optional(v.number()),
  }).index("by_endpoint", ["endpoint"]),

  apiTokens: defineTable({         // cached OAuth tokens (OpenSky etc. — actions are stateless)
    provider: v.string(),
    token: v.string(),
    expiresAt: v.number(),
  }).index("by_provider", ["provider"]),

  snapshots: defineTable({         // throttled aggregates the client subscribes to instead of raw scans:
    key: v.string(),               // "positions:vessel" | "positions:aircraft" | "counts" | …
    json: v.string(),              // compact payload, updated at most every 30s by ingest paths
    updatedAt: v.number(),
  }).index("by_key", ["key"]),
});
```

## 4. Normalized contracts

**SignalKind** (closed enum, extend only here): `earthquake · tremor · tsunami · weather-alert · public-alert · wildfire · hotspot · evac-order · smoke · road-event · outage · transit-alert · marine-notice · closure-fishery · vessel-event · aircraft-event · space-weather · launch · news · civic · event · sighting · anomaly · derived`.

**Severity** maps every upstream scale onto `info | watch | warning | critical`. Mapping is the feed module's job and must be documented in a comment citing the upstream field (e.g. ECCC `alert_type` + `risk_colour_en` → severity).

**Confidence** ∈ [0,1]: 1.0 = authoritative instrument/agency (USGS, ECCC, BCWS); 0.8 = community-instrument (PurpleAir, APRS, adsb.fi); 0.6 = aggregated/modeled (GDELT tone, smoke model, OVATION); 0.4 = scraped/unofficial (YYJ board, news geocoding). Derived signals: product of contributors × rule confidence.

**Provenance** (stringified JSON on every record): `{ method: "poll"|"stream"|"derived", fetchedAt, upstreamId?, url? }`.

**dedupeKey** convention: `"<sourceSlug>:<upstream stable id>"`; where upstream has no id, a content hash of the stable fields. Upserts: mutation looks up `by_dedupe`, patches if exists (refreshing `observedAt`/severity/geometry), inserts otherwise.

**The VI bbox** lives in exactly two places (one per runtime): `src/lib/bbox.ts` and `convex/lib/geo.ts`, both exporting `VI_BBOX = { south: 48.20, west: -125.30, north: 51.10, east: -123.10 }` plus the documented per-source variants (Cascadia seismic box, marine boxes). Worker copies it via its own constant — three total, each commented as a mirror.

## 5. Feed module pattern (Phase 3 contract — one file per source)

Every feed module exports exactly:

```ts
// convex/feeds/<camelSlug>.ts
export const sync = internalAction(...)   // fetch + normalize + ctx.runMutation(ingest)
export const ingest = internalMutation(...) // upsert into core tables + health row
```

Rules sub-agents must follow:
1. **Conform to SOURCES.md.** Endpoint, auth, cadence, attribution come from the catalog entry. If reality diverges at build time, fix SOURCES.md in the same commit.
2. **Wrap fetches in `lib/fetchSource.ts`**: 20s timeout, one retry with jitter, `If-Modified-Since`/ETag where the source supports it, 429 → exponential backoff flag in the health row. User-Agent: `BlindSpot/1.0 (personal OSINT console; samuel.putra101@gmail.com)` — several sources (CBC, api.weather.gov, GDELT) gate on UA.
3. **Health is not optional.** Success → `lastSuccessAt`, `lastCount`, `consecutiveFailures=0`, status `live`. Failure → increment failures, keep last data, status `stale` (1–2 failures) → `down` (3+). Never throw past the wrapper; a dead feed must never kill a cron batch.
4. **VI-filter server-side** before writing (bbox or region list per SOURCES.md notes).
5. **Size discipline.** `raw` capped at 2KB per record; polygons simplified (Turf `simplify`, tolerance per layer) before storing geojson; no unbounded inserts — every module states its worst-case record count in a header comment.
6. **Idempotent.** Re-running `sync` twice produces no duplicates (dedupeKey upserts).
7. **Secrets** via `process.env` inside the action only; document the env var name in the module header + README table.
8. **Shared parsers, not per-module choices.** XML/CAP/RSS feeds (NAAD, NTWC, news outlets, marine text, UVic mesh, SWOB) go through `convex/lib/xml.ts` wrapping `fast-xml-parser` (pure JS — works in the default runtime). GTFS-Realtime protobuf decodes via `gtfs-realtime-bindings` in a `"use node"` action. GTFS **static** (4.5MB zips × 7 Island systems) is NOT parsed in Convex: a build-time script (`scripts/gtfs-static.mjs`) generates curated per-system route/stop GeoJSON committed to the client bundle; Convex handles only the realtime side (vehicle positions → `entities`, TripUpdates → delays in `state`, alerts → `signals`).
9. **OAuth sources** cache tokens in `apiTokens` (actions are stateless); refresh when `expiresAt - 60s` passed.
10. **Mover ingest also maintains snapshots:** any module writing high-churn `entities` updates the matching `snapshots` row (`positions:<kind>`, compact JSON, ≥30s between writes) — client mover layers subscribe to snapshots, never to raw entity scans (§10, §11).

**Cron registry** (`convex/crons.ts`) groups feeds into named lanes per DECISIONS D8 (fast 90–120s / medium 5–15m / slow 30–60m+/daily), one cron per feed (clear health attribution), staggered offsets where the API allows (e.g. `crons.interval` with distinct periods to avoid synchronized bursts). The **brain tick is a single 120s cron** (`brain.evaluate`) running fusion → geofences → anomaly → (every 8th tick) threat in sequence — one job, not four — and its internal reads/writes are **batched**: one `loadBrainContext` internal query (fences + fresh movers + active signals + counters from `snapshots`) and one `commitBrainResults` mutation per tick, so a tick costs ~4–6 function calls, not 10–30.

## 6. AIS worker (`workers/ais/`)

Single-purpose Node process (no framework): connect `wss://stream.aisstream.io/v0/stream`, send subscription within 3s (`APIKey`, `BoundingBoxes: [[[48.20,-125.30],[51.10,-123.10]]]`, `FilterMessageTypes: ["PositionReport","ShipStaticData"]`), thin to **one position per vessel per 30s** in memory, batch-POST every **30s** (aligned with the thinning window — ≈ 86K–173K function calls/mo, budgeted in DECISIONS D8) to the Convex `httpAction` `/ingest/ais` with `Authorization: Bearer ${INGEST_SECRET}`. Reconnect with exponential backoff + jitter (aisstream is beta, no SLA). Convex side: validates secret, upserts `entities` (kind `vessel`) + appends `tracks`, marks the `aisstream` source row live. A watchdog check in the brain tick flags the source `stale` when no batch arrives for 5 min — the UI shows last-known + stale chips, and BC Ferries positions (polled feed) keep the SEAS picture alive. Deploy: Dockerfile, env (`AISSTREAM_KEY`, `CONVEX_URL`, `INGEST_SECRET`); host decision per DECISIONS D2.

## 7. The brain (Phase 4 contracts)

### 7.1 Fusion rules
Implementations are **typed TS functions in code**, not a JSON DSL interpreter — `convex/brain/rules/<slug>.ts` exporting `evaluate(ctx, params): Promise<DerivedCandidate[]>`, registered in `brain/rules/index.ts`. The `rules` table holds config: enable flag, severity, JSON params (thresholds, radii). Rationale: a hand-rolled DSL is a correctness liability; code rules are testable with synthetic fixtures (Phase 6 requires a rule to fire on synthetic input). Seed rules (from BRIEF §8.1): `tsunami-correlation`, `smoke-eta`, `sanctions-match`, `squawk-emergency`, `ais-gap-sensitive`. Derived candidates are deduped (`dedupeKey = "derived:<rule>:<hash of contributors>"`) and written as `signals` kind `derived` with `derivedFrom` + `rationale` + computed confidence.

### 7.2 Geofences
Brain tick loads active fences + fresh movers (entities `lastSeenAt` within 10 min, kind ∈ fence.entityKinds), tests Turf `booleanPointInPolygon`, updates `geofenceStates`, fires on the configured transition (`enter`/`exit`/`dwell≥dwellSec`) → emits a `derived` signal + alerting (§7.6). Staleness is a transition: when an entity that was inside goes stale (drops out of the fresh set), treat it as `exit` and clear `insideSince` — otherwise a vessel that goes dark inside a fence never exits and spuriously "dwells" when it reappears. Auto-fences: the wildfire feed module requests a 20km buffer fence per new fire ≥ a size threshold (param), tagged `auto:"fire:<id>"`; GC removes the fence **and cascade-deletes its `geofenceStates` rows** when the fire expires.

### 7.3 Anomaly detection
Sample storage: the brain tick writes its counts (`count:aircraft`, `count:vessel`, …) as `readings` rows under `stationId "brain:counts"` at 15-min resolution — these are exempt from the readings downsample purge until 7d so baselines have a sample population (current state alone can't back a rolling window). Hourly cron updates `baselines` (mean/stddev/p95 over rolling 7d windows, time-of-day bucketed where it matters: `count:aircraft`, `count:vessel`, `rate:quakes`, `reading:aqhi:*`, `reading:water_level:*`). Brain tick compares current values, flags z-score > 3 (param) → `derived` signal kind `anomaly`. AIS-gap: watched vessels whose `lastSeenAt` gap > 15 min while previously reporting in-bbox → anomaly with last heading/dead-reckoned position (Turf `destination`). **Health-gated:** the AIS-gap rule (and its dead-reckoning output) is suppressed whenever the `aisstream` source status ≠ `live` — a worker outage must not mass-fire false vessel anomalies.

### 7.4 AI analyst
`convex/brain/analyst.ts` action (default runtime, direct `fetch` to the Anthropic Messages API). **Read-only tool loop** (max 8 iterations) over internal queries: `query_signals`, `query_entities`, `query_readings`, `query_alerts`, `get_threat`, `get_source_health`, `count_by_kind` — each takes `{sinceMinutes?, kind?, bbox?, near?{lat,lng,km}, limit}` and applies Turf post-filters. Model `claude-sonnet-4-6`, system prompt + tool defs under prompt caching. Response contract: `{ prose, highlights?: { signalIds, entityIds, bbox? } }` — client renders prose + flies to/pulses highlights. The action never calls mutations; enforce by construction (tools only reference `internal.queries.*`).

### 7.5 INTSUM
Cron every 4h: snapshot via the same internal queries (counts, top signals by severity, threat factors, feed health), `claude-haiku-4-5` with a fixed editorial prompt (terse, factual, BLUF, no speculation beyond labeled projections), store in `intsums`, surface latest on COMMAND + ANALYST. On-demand regenerate button calls the same action.

### 7.6 Alerting
`brain/alerting.ts` internalAction `notify({severity, title, body, dedupeKey, signalId?})` is **edge-triggered**: a dedupeKey fires on first occurrence or on severity escalation, never on steady-state re-evaluation (the brain tick re-emitting a persisting condition must not re-notify). Re-fire windows for a *continuing* condition: info 6h / watch 1h / warning 15m / **critical 10m** (a zero window on critical would storm push+TTS every tick). Writes `notifications`; fans out — ntfy (plain `fetch`, default runtime) always; web push via `brain/push.ts` (`"use node"`, `web-push`, VAPID from env — separate file, runtimes can't mix) to all `pushSubscriptions`; client toasts + TTS for `critical` via a reactive query on unacked notifications. Tier rate limits: max 4 info/h, 12 watch/h; warning/critical uncapped but edge-triggered as above.

### 7.7 Threat level
Computed every 8th brain tick (≈15 min — matching the schema's "last ~96 rows = 24h" retention) from active signals/alerts: `score = Σ severityWeight × recencyDecay × proximityWeight` (proximity to population centroids: Victoria, Nanaimo, Comox, Port Alberni, Campbell River). Thresholds → NOMINAL/ELEVATED/HIGH; factors list stored for the SYSTEM page. Tuning params in code constants — this is a heuristic and is labeled as such in the UI.

### 7.8 Incidents
CRUD mutations + an `addSignals` mutation (from map multi-select / inspector) writing `incidentSignals` rows; timeline entries go to `incidentEvents` and auto-entries fire only on **material transitions** of attached signals (severity/status/geometry change — not every poll-refresh of `observedAt`, which would append hundreds of rows/day). Export: client-side markdown brief generation (title, timeline, map snapshot via deck.gl `toDataURL`, contributing signals with provenance) → download; PDF via browser print stylesheet (no server PDF dependency).

### 7.9 Geo-analytics & predictive overlays (BRIEF §8.7)
Client-side Turf + deck.gl, all outputs **labeled as projections** (confidence ≤ 0.6, distinct dashed/hatched styling): range/evacuation rings (concentric Turf buffers around a selected point; true road-network isochrones deliberately out of scope — no routing dependency); viewshed/line-of-sight from cams/peaks via DEM sampling (terrain: AWS Open Data terrarium tiles `s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png` — keyless; verify at build and record in SOURCES.md); KDE hotspots (deck.gl HeatmapLayer over signal history); fire-spread cone (elliptical wind-driven growth from perimeter + wind vector — explicitly a toy model, labeled); smoke ETA (wind advection along plume centroid, feeds the `smoke-eta` fusion rule); aurora-over-Island tonight (OVATION oval intersection + Kp threshold + cloud cover + light pollution overlay); satellite ground tracks + pass predictions (satellite.js TLE propagation, client-side); dead-reckoned positions during AIS/ADS-B gaps (Turf `destination` from last heading/speed, capped at 30 min).

### 7.10 Watchlist pattern-of-life (BRIEF §8.3)
Daily cron per active watchlist entity aggregates its retained `tracks` into a rolling profile stored as JSON on the `watchlist` row (`pattern` field): dwell sites (grid-bucketed clusters of low-speed points), active-hours histogram (UTC buckets), typical transit corridors (simplified track bundles via Turf `simplify`), last-30d sightings count. Incremental: each run folds the last 24–48h of tracks into the stored profile, so PoL outlives the 48h track retention. INSPECTOR renders the profile; public assets only, per guardrails.

## 8. Time as the second axis

Global scrubber state (zustand): `{ mode: "live" | "replay", t: number, windowH: 1|6|24|48 }`. Live mode: layers read "now" queries. Replay: the client fetches the window via **bounded history queries** — a single Convex query may scan at most 32K docs / read 16 MiB, and 48h of tracks is far beyond that — so history access is (a) per-entity: `tracks` `.take()` against `by_entity_at` with server-side downsampling to ≤ 500 points/entity/window, fetched for visible/selected entities only, and (b) paginated for `signals`/`readings` (cursor pagination, page ≤ 1K rows). Scrubbing is then client-side (deck.gl data filtered by `at ≤ t`, TripsLayer `currentTime` for movers). Retention (§11) guarantees 48h of track history — the scrubber's max window is bound to retention, enforced in one constant.

## 9. Pages & routing

TanStack Router file routes; all gated behind Convex Auth (single operator account, no signup UI): `/command` (default) `/hazard` `/skies-seas` `/ground` `/signals` `/infrastructure` `/pulse` `/environment` `/space` `/analyst` `/incidents` `/world` `/cams` `/system` `/wall`. INSPECTOR is an overlay routed by search param (`?inspect=<entityId|signalId>`) so it works on every page. WALL is chrome-less, auto-rotating (configurable dwell), and ignores auth idle timeout. WORLD switches MapLibre to globe projection and swaps the layer registry to the world set.

## 10. Client layer registry

`src/layers/registry.ts` — every map layer is one entry:

```ts
interface LayerDef<T> {
  id: string;                    // "quakes", "vessels", "fires", …
  label: string;                 // rail label, UPPERCASE micro-style
  pages: PageId[];               // which pages show it
  cluster: string;               // SOURCES.md cluster, for SYSTEM cross-link
  useData(): { data: T[]; updatedAt?: number };   // wraps convex useQuery (+ scrubber awareness)
  toLayers(data: T[], ctx: LayerCtx): Layer[];    // deck.gl layer factories
  count(data: T[]): number;      // rail badge
  defaultOn: boolean;
}
```

The layer rail, live counts, "updated Xs ago" chips, and ⌘K layer jumps all derive from this registry — no page hand-wires deck.gl. Conventions: `ScatterplotLayer` pulses for new/critical via a time-driven radius transition; `IconLayer` oriented by `heading`; `TripsLayer` for trails (data from `tracks`); `GeoJsonLayer` for polygons (alerts/fires/fences); raster overlays (GeoMet radar/satellite/lightning-density) are **MapLibre raster sources** (CORS-open, browser-direct), toggled through the same registry interface with a `kind: "raster"` variant. Two hard conventions for sub-agents: (1) **mover layers read `snapshots` rows** (`positions:<kind>`), never raw `entities` scans — bounds reactive re-execution and bandwidth (§11); (2) **TripsLayer timestamps are rebased to seconds since window start** in the layer transform — epoch-ms in float32 quantizes at ~2 min and freezes trails.

`<LiveMedia>` (BRIEF §6): resolves `cameras.kind` → snapshot (`<img>` + cache-bust on `refreshSec`, pause offscreen) / hls (hls.js; Safari native) / iframe (sandboxed) / audio (`<audio>` + hls.js for Orcasound). Every instance renders attribution + "updated Xs ago". Orcasound needs the `latest.txt → live.m3u8` folder-rollover resolver from SOURCES.md.

## 11. Retention & budget (Convex free tier: 1M calls, 0.5 GB DB, 1 GB/mo DB bandwidth)

**Retention** runs hourly but is **self-rescheduling**: the entry action deletes in batches of ≤4K rows and re-schedules itself (`ctx.scheduler.runAfter(0, …)`) until no work remains — a single hourly batch (98K rows/day ceiling) cannot keep up with mover inflow and would backlog to the storage cap. Policy: `tracks` > 48h deleted; `readings` > 24h downsampled to 15-min resolution, > 7d deleted (`brain:counts` readings exempt from downsample, purged at 7d); `signals` expired or > 14d (except `derived` + incident-attached, 30d); `notifications` > 30d; `threat` > 24h; `intsums` > 90d; **`entities`** stale > 7d and not watchlisted deleted (icao24/vehicle churn otherwise grows unboundedly); **`geofenceStates`** cascade-deleted with their fence or entity.

**Storage:** worst driver is AIS tracks: ~200 vessels × 2880 points/day × 2 days ≈ 1.1M rows is too much → worker thins to 30s and tracks store only movers' *changes* (skip writes when displacement < 50m), targeting ≈ 150–300MB steady state. If pressure persists: thin to 60s, drop to 24h replay.

**Function calls (full model — DECISIONS D8):** cron lanes ~0.5–0.7M/mo + brain tick (batched, ~4–6 calls/tick at 120s ≈ 130–190K/mo) + **AIS worker ingest (30s batches ≈ 90–170K/mo)** + reactive query re-runs (see below) ≈ **~1–1.3M/mo** → free tier ± a dollar of overage. Revisit cadences before adding fast lanes.

**DB bandwidth (1 GB/mo) is a real constraint, not a footnote.** Mitigations are structural: (a) client mover layers subscribe to compact `snapshots` docs (~20KB, updated ≥30s apart), never raw entity scans — an always-on WALL re-reading a full vessels query per ingest batch would alone burn ~0.5GB/mo; (b) anomaly counts come from counters maintained incrementally by ingest mutations (in `snapshots`), never per-tick table scans; (c) `raw` payloads capped at 2KB and polygons simplified before write. If the build still exceeds 1GB/mo, the documented fallback is enabling pay-as-you-go (≈$1–3/mo — Samuel's call, flagged in DECISIONS D8 alongside the D2 worker-hosting cost).

## 12. Security & degradation

- Secrets only in Convex env (third-party keys, `ANTHROPIC_API_KEY`, `INGEST_SECRET`, VAPID) and worker env. Client bundle: zero secrets (Phase 6 greps the build). OpenFreeMap needs no token.
- `http.ts` ingest route: constant-time bearer check, 1MB body cap, rejects out-of-bbox points.
- Auth: Convex Auth Password, one account, session-cookie SPA. No public signup; account seeded at deploy.
- Degradation ladder per source: `live → stale (UI chip, last-known rendered) → down (SYSTEM red, layer shows last-known + age)`. The board never blanks and never fabricates: missing is shown as missing.
- Attribution: rendered per-layer from the `sources` row; global footer disclaimer per BRIEF §5.3.

## 13. Testing & audit hooks

- `convex/brain/rules/*` ship with synthetic-fixture tests (a rule must fire on crafted input — Phase 6 acceptance).
- Feed modules: a `--once` dev harness (`npx convex run feeds/<slug>:sync`) is the smoke test; SYSTEM page is the live assertion.
- `tsc --noEmit` + ESLint green per commit; CI not required for a single operator but the commands are documented in README.
