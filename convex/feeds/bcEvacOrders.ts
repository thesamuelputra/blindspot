import { v } from 'convex/values';
import { internalAction, internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { fetchSource } from '../lib/fetchSource';
import { VI_BBOX } from '../lib/geo';
import { reportSuccess, reportFailure, type SourceMeta } from '../lib/ingest';
import { bbox as turfBbox, simplify } from '@turf/turf';
import type { Feature, MultiPolygon, Polygon } from 'geojson';

// bc-evac-orders — SOURCES.md: Wildfire. GeoBC ArcGIS Online FeatureServer
// (Evacuation_Orders_and_Alerts layer 0), no auth, all hazard types (fire,
// flood, landslide...). Server-side VI envelope filter via the ArcGIS query
// (spatialRel=esriSpatialRelIntersects), re-checked locally with a turf bbox
// overlap test. Writes to the `alerts` table (rendered by the shared WX ALERTS
// layer), not `signals`. Worst case ~50 records/sync inside the VI bbox in a
// severe wildfire season (9 province-wide / 2 in-bbox at verify, 2026-06-11);
// hard-capped at 500 by resultRecordCount. Cadence: medium lane (900s).
const META: SourceMeta = {
  slug: 'bc-evac-orders',
  name: 'BC Evacuation Orders & Alerts',
  cluster: 'Wildfire',
  cadenceSec: 900,
  attribution: 'Contains information licensed under the Open Government Licence - British Columbia.',
};

type AlertStatus = 'active' | 'expired' | 'cancelled';

interface AlertInput {
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
  status: AlertStatus;
}

interface EvacFeature {
  geometry: Polygon | MultiPolygon | null;
  properties: {
    EMRG_OAA_SYSID: number;
    EVENT_NAME: string | null;
    EVENT_TYPE: string | null;
    ORDER_ALERT_STATUS: string | null;
    ORDER_ALERT_NAME: string | null;
    ISSUING_AGENCY: string | null;
    DATE_MODIFIED: number | null;
    EVENT_START_DATE: number | null;
  };
}

// Severity from upstream ORDER_ALERT_STATUS (observed domain at build time:
// 'Order' | 'Alert' — distinct-values query returned only these two):
//   'Order'  (evacuate now)  → critical
//   'Alert'  (be ready to go) → warning
// Anything else ('Rescinded', 'All Clear', ...) → row status 'cancelled',
// severity downgraded to info. Lifted orders are usually just REMOVED from the
// layer rather than re-statused, so ingest also cancels our active rows that
// vanished from the response.
function classify(raw: string): { severity: AlertInput['severity']; status: AlertStatus } {
  if (raw === 'Order') return { severity: 'critical', status: 'active' };
  if (raw === 'Alert') return { severity: 'warning', status: 'active' };
  return { severity: 'info', status: 'cancelled' };
}

// Aggressive Turf simplification — evac polygons can be parcel-precision and
// huge; escalate tolerance until the stringified geometry is under 50KB.
function simplifyArea(geometry: Polygon | MultiPolygon): string {
  let json = JSON.stringify(geometry);
  for (const tolerance of [0.0002, 0.001, 0.005, 0.02]) {
    if (json.length <= 50_000) break;
    const feature: Feature<Polygon | MultiPolygon> = { type: 'Feature', properties: {}, geometry };
    json = JSON.stringify(simplify(feature, { tolerance, highQuality: false, mutate: false }).geometry);
  }
  return json;
}

export const sync = internalAction({
  args: {},
  handler: async (ctx) => {
    const params = new URLSearchParams({
      where: '1=1',
      outFields:
        'EMRG_OAA_SYSID,EVENT_NAME,EVENT_TYPE,ORDER_ALERT_STATUS,ORDER_ALERT_NAME,ISSUING_AGENCY,DATE_MODIFIED,EVENT_START_DATE',
      f: 'geojson',
      outSR: '4326',
      geometryPrecision: '5',
      geometry: `${VI_BBOX.west},${VI_BBOX.south},${VI_BBOX.east},${VI_BBOX.north}`,
      geometryType: 'esriGeometryEnvelope',
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      resultRecordCount: '500',
    });
    const url =
      'https://services6.arcgis.com/ubm4tcTYICKBpist/arcgis/rest/services/Evacuation_Orders_and_Alerts/FeatureServer/0/query?' +
      params.toString();
    try {
      const res = await fetchSource(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { features?: EvacFeature[]; error?: { message?: string } };
      // ArcGIS reports query errors in a 200 body
      if (!Array.isArray(data.features)) throw new Error(`ArcGIS error: ${data.error?.message ?? 'no features array'}`);
      const fetchedAt = Date.now();
      const alerts: AlertInput[] = [];
      for (const f of data.features) {
        if (!f.geometry) continue;
        // Belt-and-braces VI filter on top of the upstream envelope query
        const [w, s, e, n] = turfBbox(f.geometry);
        if (e < VI_BBOX.west || w > VI_BBOX.east || n < VI_BBOX.south || s > VI_BBOX.north) continue;
        const p = f.properties;
        const rawStatus = p.ORDER_ALERT_STATUS ?? 'Unknown';
        const { severity, status } = classify(rawStatus);
        const name = p.EVENT_NAME ?? p.ORDER_ALERT_NAME ?? 'Unnamed event';
        const headline =
          status === 'active' ? `Evacuation ${rawStatus} — ${name}` : `${rawStatus} — ${name}`;
        const description = [
          p.EVENT_TYPE,
          p.ORDER_ALERT_NAME && p.ORDER_ALERT_NAME !== name ? p.ORDER_ALERT_NAME : null,
          p.ISSUING_AGENCY ? `Issued by ${p.ISSUING_AGENCY}` : null,
        ]
          .filter(Boolean)
          .join(' · ');
        alerts.push({
          sourceSlug: META.slug,
          // EMRG_OAA_SYSID is the BC Geographic Warehouse system id — stable,
          // unlike OBJECTID which ArcGIS may reassign on republish.
          capId: `${META.slug}:${p.EMRG_OAA_SYSID}`,
          headline,
          description: description || undefined,
          severity,
          area: simplifyArea(f.geometry),
          effective: p.EVENT_START_DATE ?? p.DATE_MODIFIED ?? fetchedAt,
          // upstream has no expiry — rows are cancelled when they leave the layer
          status,
        });
      }
      await ctx.runMutation(internal.feeds.bcEvacOrders.ingest, { alerts });
    } catch (e) {
      await ctx.runMutation(internal.feeds.bcEvacOrders.fail, { error: String(e) });
    }
  },
});

export const ingest = internalMutation({
  args: { alerts: v.array(v.any()) },
  handler: async (ctx, args) => {
    const alerts = args.alerts as AlertInput[];
    const seen = new Set<string>();
    let inserted = 0;
    let updated = 0;
    for (const a of alerts) {
      seen.add(a.capId);
      const existing = await ctx.db
        .query('alerts')
        .withIndex('by_cap', (q) => q.eq('capId', a.capId))
        .unique();
      if (existing) {
        await ctx.db.patch(existing._id, {
          headline: a.headline,
          description: a.description,
          severity: a.severity,
          area: a.area,
          effective: a.effective,
          expires: a.expires,
          status: a.status,
        });
        updated++;
      } else {
        await ctx.db.insert('alerts', a);
        inserted++;
      }
    }
    // Lifted orders/alerts are removed from the upstream layer, not flipped to
    // 'Rescinded' — cancel our active rows that vanished from this response.
    // (Empty fair-weather responses correctly cancel everything still active.)
    const actives = await ctx.db
      .query('alerts')
      .withIndex('by_status', (q) => q.eq('status', 'active'))
      .collect();
    for (const row of actives) {
      if (row.sourceSlug === META.slug && !seen.has(row.capId)) {
        await ctx.db.patch(row._id, { status: 'cancelled' });
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
