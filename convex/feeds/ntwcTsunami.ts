import { v } from 'convex/values';
import { internalAction, internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { fetchSource } from '../lib/fetchSource';
import { parseXml, asArray } from '../lib/xml';
import { reportSuccess, reportFailure, type SourceMeta } from '../lib/ingest';
import * as turf from '@turf/turf';
import type { Geometry, Point, Polygon } from 'geojson';

// ntwc-tsunami — SOURCES.md: Seismic & Tsunami. tsunami.gov Atom feeds plus
// per-event CAP 1.2 XML, no auth. PAAQ (NTWC Palmer AK — the center
// responsible for BC/AK/US west coast) is primary; PHEB (PTWC Honolulu) adds
// far-field Pacific events per the SOURCES.md gotchas. These are current-state
// feeds, not archives: entries persist between events and the docs can sit
// stale for weeks — NO ACTIVE MESSAGES IS THE NORMAL CASE, count 0 is success.
// Writes to the `alerts` table (rendered by the shared WX ALERTS layer), not
// signals. Worst case ~20 alerts/sync (2 feeds × 10 newest entries, ~22 HTTP
// GETs). Cadence: fast lane (119s) — the cluster's primary alerting feed.
const META: SourceMeta = {
  slug: 'ntwc-tsunami',
  name: 'NTWC Tsunami Alerts (tsunami.gov)',
  cluster: 'Seismic & Tsunami',
  cadenceSec: 119,
  attribution: 'NOAA / NWS National Tsunami Warning Center',
};

const FEEDS = [
  'https://www.tsunami.gov/events/xml/PAAQAtom.xml', // NTWC Palmer — BC / AK / US west coast
  'https://www.tsunami.gov/events/xml/PHEBAtom.xml', // PTWC Honolulu — far-field Pacific
];

// Server-side region filter (stands in for the VI bbox — tsunami messages are
// coastline-scoped text, not point hazards). PAAQ also issues messages for the
// US east coast/Gulf (verified live: WEXX32 'Cuba region' statement) and PHEB
// covers the whole Pacific basin, so keep a message only if its CAP headline /
// description / instruction / areaDesc mentions the BC coast / Pacific NW or a
// basin-wide Pacific threat.
const PACIFIC_NW =
  /british columbia|vancouver island|haida gwaii|pacific|west coast|alaska|washington|oregon|california/i;

// Severity maps the CAP <info><event> message category — NTWC issues 'Tsunami
// Warning' | 'Tsunami Advisory' | 'Tsunami Watch' | 'Tsunami Information':
// warning→critical, advisory→warning, watch→watch, information→info.
// Cancellations (msgType=Cancel or 'cancel' in the event text) → info. The
// CAP <info><severity> field (Extreme..Minor) is deliberately not used; the
// message category is the operational scale.
const SEVERITY = (eventText: string): 'info' | 'watch' | 'warning' | 'critical' => {
  const t = eventText.toLowerCase();
  if (t.includes('cancel')) return 'info';
  if (t.includes('warning')) return 'critical';
  if (t.includes('advisory')) return 'warning';
  if (t.includes('watch')) return 'watch';
  return 'info';
};

interface CapArea {
  areaDesc?: unknown;
  polygon?: unknown;
  circle?: unknown;
}

interface CapInfo {
  language?: unknown;
  event?: unknown;
  urgency?: unknown;
  certainty?: unknown;
  effective?: unknown;
  onset?: unknown;
  expires?: unknown;
  headline?: unknown;
  description?: unknown;
  instruction?: unknown;
  area?: CapArea | CapArea[];
}

interface CapAlert {
  identifier?: unknown;
  sent?: unknown;
  status?: unknown;
  msgType?: unknown;
  references?: unknown;
  info?: CapInfo | CapInfo[];
}

interface AlertRow {
  sourceSlug: string;
  capId: string;
  headline: string;
  description?: string;
  severity: 'info' | 'watch' | 'warning' | 'critical';
  urgency?: string;
  certainty?: string;
  area?: string;
  effective: number;
  expires?: number;
  status: 'active' | 'expired' | 'cancelled';
}

// CAP <info> may repeat (per language/product); prefer the English block.
function pickInfo(info: CapInfo | CapInfo[] | undefined): CapInfo | undefined {
  const arr = asArray(info);
  return (
    arr.find((i) => i.language === undefined || String(i.language).toLowerCase().startsWith('en')) ??
    arr[0]
  );
}

// CAP <area> → bare GeoJSON Geometry string (the shared WX ALERTS layer
// JSON.parses `area` as a Geometry, not a Feature). Coastal warning segments
// arrive as <polygon> "lat,lon lat,lon ..." lists; information statements
// carry an epicenter <circle> "lat,lon radius_km" (radius usually 0 → Point).
function areaGeometry(areas: CapArea | CapArea[] | undefined): string | undefined {
  const polys: Polygon[] = [];
  const points: Point[] = [];
  for (const a of asArray(areas)) {
    for (const polyText of asArray(a.polygon)) {
      const ring = String(polyText)
        .trim()
        .split(/\s+/)
        .map((pair) => pair.split(',').map(Number))
        .filter((c) => c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]))
        .map(([lat, lng]) => [lng, lat]);
      if (ring.length < 3) continue;
      const [fx, fy] = ring[0];
      const [lx, ly] = ring[ring.length - 1];
      if (fx !== lx || fy !== ly) ring.push([fx, fy]); // CAP rings may be unclosed
      let feature = turf.polygon([ring]);
      // Size discipline (ARCHITECTURE §5.5): simplify long coastal segments.
      if (ring.length > 200) {
        feature = turf.simplify(feature, { tolerance: 0.02, highQuality: false });
      }
      polys.push(feature.geometry);
    }
    for (const circleText of asArray(a.circle)) {
      const m = String(circleText)
        .trim()
        .match(/^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)/);
      if (!m) continue;
      const lat = Number(m[1]);
      const lng = Number(m[2]);
      const radiusKm = Number(m[3]);
      if (radiusKm > 0) {
        polys.push(turf.circle([lng, lat], radiusKm, { steps: 32, units: 'kilometers' }).geometry);
      } else {
        points.push({ type: 'Point', coordinates: [lng, lat] });
      }
    }
  }
  const geoms: Geometry[] = [...polys, ...points];
  if (geoms.length === 0) return undefined;
  if (geoms.length === 1) return JSON.stringify(geoms[0]);
  if (points.length === 0) {
    return JSON.stringify({ type: 'MultiPolygon', coordinates: polys.map((p) => p.coordinates) });
  }
  return JSON.stringify({ type: 'GeometryCollection', geometries: geoms });
}

export const sync = internalAction({
  args: {},
  handler: async (ctx) => {
    try {
      const fetchedAt = Date.now();
      const alerts: AlertRow[] = [];
      const cancelledCapIds: string[] = [];
      let capAttempts = 0;
      let capFailures = 0;
      const errors: string[] = [];

      for (const feedUrl of FEEDS) {
        const res = await fetchSource(feedUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status} on ${feedUrl}`);
        const atom = parseXml(await res.text());
        // newest entries only — the Atom docs are tiny current-state feeds
        const entries = asArray(atom?.feed?.entry).slice(0, 10);
        for (const entry of entries) {
          const capUrl = asArray(entry?.link).find((l) => l?.['@_type'] === 'application/cap+xml')?.[
            '@_href'
          ];
          if (typeof capUrl !== 'string') continue; // no CAP doc → no severity/expiry; skip
          capAttempts++;
          try {
            const capRes = await fetchSource(capUrl);
            if (!capRes.ok) throw new Error(`HTTP ${capRes.status}`);
            const cap: CapAlert | undefined = parseXml(await capRes.text())?.alert;
            if (!cap?.identifier) throw new Error('no CAP <alert><identifier>');
            // CAP <status>: only 'Actual' is real traffic (skip Exercise/System/Test/Draft)
            if (String(cap.status) !== 'Actual') continue;
            const info = pickInfo(cap.info);
            if (!info) continue;
            const searchable = [
              info.headline,
              info.description,
              info.instruction,
              ...asArray(info.area).map((a) => a.areaDesc),
            ]
              .filter(Boolean)
              .join(' ');
            if (!PACIFIC_NW.test(searchable)) continue;
            const msgType = String(cap.msgType ?? 'Alert');
            if (msgType === 'Cancel') {
              // CAP <references> = space-separated "sender,identifier,sent" triplets
              for (const ref of String(cap.references ?? '')
                .trim()
                .split(/\s+/)) {
                const refId = ref.split(',')[1];
                if (refId) cancelledCapIds.push(refId);
              }
            }
            const eventText = String(info.event ?? info.headline ?? '');
            const sent = Date.parse(String(cap.sent ?? ''));
            const effective = Date.parse(String(info.effective ?? info.onset ?? cap.sent ?? ''));
            const expiresMs = info.expires !== undefined ? Date.parse(String(info.expires)) : NaN;
            const cancelled = msgType === 'Cancel' || /cancel/i.test(eventText);
            alerts.push({
              sourceSlug: META.slug,
              capId: String(cap.identifier),
              headline: String(info.headline ?? info.event ?? 'Tsunami message').slice(0, 300),
              description:
                info.description !== undefined
                  ? String(info.description).slice(0, 2000)
                  : undefined,
              severity: SEVERITY(eventText),
              urgency: info.urgency !== undefined ? String(info.urgency) : undefined,
              certainty: info.certainty !== undefined ? String(info.certainty) : undefined,
              area: areaGeometry(info.area),
              effective: Number.isFinite(effective)
                ? effective
                : Number.isFinite(sent)
                  ? sent
                  : fetchedAt,
              expires: Number.isFinite(expiresMs) ? expiresMs : undefined,
              status: cancelled
                ? 'cancelled'
                : Number.isFinite(expiresMs) && expiresMs < fetchedAt
                  ? 'expired'
                  : 'active',
            });
          } catch (e) {
            capFailures++;
            errors.push(`${capUrl}: ${String(e)}`);
          }
        }
      }
      // Per-entry CAP failures are tolerated unless every one failed — during a
      // real event a partial picture beats losing the whole sync to one 404.
      if (capAttempts > 0 && capFailures === capAttempts) {
        throw new Error(`all ${capAttempts} CAP fetches failed: ${errors.join('; ')}`);
      }
      await ctx.runMutation(internal.feeds.ntwcTsunami.ingest, { alerts, cancelledCapIds });
    } catch (e) {
      await ctx.runMutation(internal.feeds.ntwcTsunami.fail, { error: String(e) });
    }
  },
});

export const ingest = internalMutation({
  args: { alerts: v.array(v.any()), cancelledCapIds: v.array(v.string()) },
  handler: async (ctx, { alerts, cancelledCapIds }) => {
    let inserted = 0;
    let updated = 0;
    for (const a of alerts) {
      const existing = await ctx.db
        .query('alerts')
        .withIndex('by_cap', (q) => q.eq('capId', a.capId))
        .unique();
      if (existing) {
        await ctx.db.patch(existing._id, {
          headline: a.headline,
          description: a.description,
          severity: a.severity,
          urgency: a.urgency,
          certainty: a.certainty,
          area: a.area,
          effective: a.effective,
          expires: a.expires,
          // a re-polled bulletin must never resurrect a cancelled alert
          status: existing.status === 'cancelled' && a.status === 'active' ? 'cancelled' : a.status,
        });
        updated++;
      } else {
        await ctx.db.insert('alerts', a);
        inserted++;
      }
    }
    // flip alerts referenced by a Cancel message
    for (const capId of cancelledCapIds) {
      const row = await ctx.db
        .query('alerts')
        .withIndex('by_cap', (q) => q.eq('capId', capId))
        .unique();
      if (row && row.status !== 'cancelled') {
        await ctx.db.patch(row._id, { status: 'cancelled' });
      }
    }
    // sweep our own still-'active' rows past expiry — the Atom doc is
    // current-state only, so a bulletin that drops out of the feed would
    // otherwise stay active forever
    const now = Date.now();
    const active = await ctx.db
      .query('alerts')
      .withIndex('by_status', (q) => q.eq('status', 'active'))
      .collect();
    for (const row of active) {
      if (row.sourceSlug === META.slug && row.expires !== undefined && row.expires < now) {
        await ctx.db.patch(row._id, { status: 'expired' });
      }
    }
    await reportSuccess(ctx, META, alerts.length);
    return { inserted, updated };
  },
});

export const fail = internalMutation({
  args: { error: v.string() },
  handler: async (ctx, { error }) => {
    await reportFailure(ctx, META, error);
  },
});
