import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { authTables } from '@convex-dev/auth/server';

// Severity scale shared by signals/alerts/notifications/geofences/rules (ARCHITECTURE §4).
const severity = v.union(
  v.literal('info'),
  v.literal('watch'),
  v.literal('warning'),
  v.literal('critical'),
);

export default defineSchema({
  ...authTables,

  // ---- registry & health ----
  sources: defineTable({
    slug: v.string(), // = SOURCES.md id, e.g. "usgs-quakes"
    name: v.string(),
    cluster: v.string(),
    status: v.union(
      v.literal('live'),
      v.literal('stale'),
      v.literal('down'),
      v.literal('disabled'),
    ),
    cadenceSec: v.number(),
    lastSyncAt: v.optional(v.number()),
    lastSuccessAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    consecutiveFailures: v.number(),
    lastCount: v.optional(v.number()),
    attribution: v.string(),
    licenseNote: v.optional(v.string()),
  })
    .index('by_slug', ['slug'])
    .index('by_cluster', ['cluster']),

  // ---- normalized core ----
  signals: defineTable({
    sourceSlug: v.string(),
    kind: v.string(), // SignalKind (ARCHITECTURE §4)
    title: v.string(),
    summary: v.optional(v.string()),
    severity,
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
    cell: v.optional(v.string()), // "48.4,-123.4" 0.2° bucket for proximity scans
    geojson: v.optional(v.string()),
    startsAt: v.optional(v.number()),
    observedAt: v.number(),
    expiresAt: v.optional(v.number()),
    dedupeKey: v.string(),
    confidence: v.number(), // 0..1
    provenance: v.string(), // JSON {method, fetchedAt, upstreamId?, url?}
    raw: v.optional(v.string()), // trimmed upstream record, ≤2KB
    derivedFrom: v.optional(v.array(v.id('signals'))),
    rationale: v.optional(v.string()),
  })
    .index('by_dedupe', ['dedupeKey'])
    .index('by_kind_observed', ['kind', 'observedAt'])
    .index('by_observed', ['observedAt'])
    .index('by_source_observed', ['sourceSlug', 'observedAt'])
    .index('by_cell', ['cell', 'observedAt']),

  entities: defineTable({
    kind: v.string(), // aircraft | vessel | bus | ferry | station | camera | fire | satellite | balloon | aprs
    extId: v.string(), // icao24 | mmsi | gtfs vehicle id | station id | norad id …
    label: v.string(),
    sourceSlug: v.string(),
    lat: v.number(),
    lng: v.number(),
    heading: v.optional(v.number()),
    speed: v.optional(v.number()),
    altitude: v.optional(v.number()),
    state: v.optional(v.string()), // JSON, kind-specific
    firstSeenAt: v.number(),
    lastSeenAt: v.number(),
    stale: v.boolean(),
    watch: v.boolean(),
  })
    .index('by_kind', ['kind', 'lastSeenAt'])
    .index('by_ext', ['kind', 'extId'])
    .index('by_watch', ['watch', 'lastSeenAt']),

  tracks: defineTable({
    entityId: v.id('entities'),
    at: v.number(),
    lat: v.number(),
    lng: v.number(),
    heading: v.optional(v.number()),
    speed: v.optional(v.number()),
    altitude: v.optional(v.number()),
  })
    .index('by_entity_at', ['entityId', 'at'])
    .index('by_at', ['at']),

  readings: defineTable({
    stationId: v.string(), // "<sourceSlug>:<upstream station id>" or "brain:counts"
    metric: v.string(),
    value: v.number(),
    unit: v.string(),
    at: v.number(),
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
    sourceSlug: v.string(),
  })
    .index('by_station_metric_at', ['stationId', 'metric', 'at'])
    .index('by_metric_at', ['metric', 'at'])
    .index('by_at', ['at']),

  alerts: defineTable({
    sourceSlug: v.string(),
    capId: v.string(),
    headline: v.string(),
    description: v.optional(v.string()),
    severity,
    urgency: v.optional(v.string()),
    certainty: v.optional(v.string()),
    area: v.optional(v.string()), // stringified GeoJSON
    effective: v.number(),
    expires: v.optional(v.number()),
    status: v.union(v.literal('active'), v.literal('expired'), v.literal('cancelled')),
  })
    .index('by_cap', ['capId'])
    .index('by_status', ['status', 'effective']),

  cameras: defineTable({
    slug: v.string(),
    name: v.string(),
    lat: v.number(),
    lng: v.number(),
    kind: v.union(v.literal('snapshot'), v.literal('hls'), v.literal('iframe'), v.literal('audio')),
    mediaUrl: v.string(),
    refreshSec: v.optional(v.number()),
    orientation: v.optional(v.number()),
    sourceSlug: v.string(),
    attribution: v.string(),
    active: v.boolean(),
    // when exact coords are unknown, the cam is placed at an estimate and
    // approxKm is the uncertainty radius (km) — the map draws a range circle
    approxKm: v.optional(v.number()),
  })
    .index('by_slug', ['slug'])
    .index('by_kind', ['kind']),

  // ---- the brain ----
  geofences: defineTable({
    name: v.string(),
    geojson: v.string(),
    rule: v.union(v.literal('enter'), v.literal('exit'), v.literal('dwell')),
    dwellSec: v.optional(v.number()),
    entityKinds: v.array(v.string()),
    severity,
    active: v.boolean(),
    auto: v.optional(v.string()), // e.g. "fire:<signalId>" when auto-generated
  }).index('by_active', ['active']),

  geofenceStates: defineTable({
    fenceId: v.id('geofences'),
    entityId: v.id('entities'),
    insideSince: v.optional(v.number()),
    lastInside: v.boolean(),
    lastFiredAt: v.optional(v.number()),
  }).index('by_fence_entity', ['fenceId', 'entityId']),

  watchlist: defineTable({
    kind: v.string(), // vessel | aircraft | infrastructure
    identifier: v.string(), // mmsi | hex | slug
    label: v.string(),
    notes: v.optional(v.string()),
    active: v.boolean(),
    pattern: v.optional(v.string()), // rolling pattern-of-life JSON (§7.10)
  })
    .index('by_active', ['active'])
    .index('by_ident', ['kind', 'identifier']),

  rules: defineTable({
    slug: v.string(), // must match a key in brain/rules registry
    name: v.string(),
    params: v.string(), // JSON, rule-specific thresholds
    severity,
    active: v.boolean(),
    lastFiredAt: v.optional(v.number()),
  })
    .index('by_slug', ['slug'])
    .index('by_active', ['active']),

  baselines: defineTable({
    metric: v.string(),
    windowHours: v.number(),
    mean: v.number(),
    stddev: v.number(),
    p95: v.number(),
    n: v.number(),
    updatedAt: v.number(),
  }).index('by_metric', ['metric']),

  incidents: defineTable({
    title: v.string(),
    status: v.union(v.literal('open'), v.literal('monitoring'), v.literal('closed')),
    createdAt: v.number(),
    annotations: v.optional(v.string()), // GeoJSON FeatureCollection (drawings)
  }).index('by_status', ['status', 'createdAt']),

  // child tables — never unbounded arrays on the incident doc
  incidentSignals: defineTable({
    incidentId: v.id('incidents'),
    signalId: v.id('signals'),
    addedAt: v.number(),
  })
    .index('by_incident', ['incidentId'])
    .index('by_signal', ['signalId']),

  incidentEvents: defineTable({
    incidentId: v.id('incidents'),
    at: v.number(),
    text: v.string(),
    auto: v.boolean(),
  }).index('by_incident_at', ['incidentId', 'at']),

  notifications: defineTable({
    at: v.number(),
    severity,
    title: v.string(),
    body: v.string(),
    channels: v.array(v.string()),
    dedupeKey: v.string(),
    ack: v.boolean(),
    signalId: v.optional(v.id('signals')),
  })
    .index('by_dedupe', ['dedupeKey', 'at'])
    .index('by_at', ['at'])
    .index('by_ack', ['ack', 'at']),

  threat: defineTable({
    computedAt: v.number(),
    level: v.union(v.literal('NOMINAL'), v.literal('ELEVATED'), v.literal('HIGH')),
    score: v.number(),
    factors: v.string(), // JSON [{label, weight, signalId?}]
  }).index('by_at', ['computedAt']),

  intsums: defineTable({
    at: v.number(),
    text: v.string(),
    model: v.string(),
    snapshot: v.optional(v.string()),
  }).index('by_at', ['at']),

  pushSubscriptions: defineTable({
    endpoint: v.string(),
    keys: v.string(), // JSON {p256dh, auth}
    createdAt: v.number(),
    lastOkAt: v.optional(v.number()),
  }).index('by_endpoint', ['endpoint']),

  apiTokens: defineTable({
    provider: v.string(),
    token: v.string(),
    expiresAt: v.number(),
  }).index('by_provider', ['provider']),

  snapshots: defineTable({
    key: v.string(), // "positions:vessel" | "positions:aircraft" | "counts" | …
    json: v.string(), // compact payload, updated at most every 30s
    updatedAt: v.number(),
  }).index('by_key', ['key']),

  // lazily-fetched intrinsic detail for an inspected entity (photo, owner,
  // specs, route). Keyed "ac:<hex>" | "ferry:<extId>". Cached so a repeatedly
  // inspected mover hits the external enrichment APIs at most once per TTL.
  enrichments: defineTable({
    key: v.string(),
    json: v.string(),
    fetchedAt: v.number(),
  }).index('by_key', ['key']),
});
