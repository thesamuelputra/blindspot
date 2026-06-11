import { v } from 'convex/values';
import { bbox as turfBbox, simplify } from '@turf/turf';
import type { Feature, MultiPolygon, Polygon } from 'geojson';
import { internalAction, internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { fetchSource } from '../lib/fetchSource';
import { VI_BBOX } from '../lib/geo';
import {
  upsertSignals,
  reportSuccess,
  reportFailure,
  type SourceMeta,
  type SignalInput,
} from '../lib/ingest';

// bcws-bans — SOURCES.md: Wildfire (bcws-fires entry, bans layer). GeoBC
// ArcGIS FeatureServer British_Columbia_Bans_and_Prohibition_Areas_-_View,
// no auth, f=geojson. NOTE: the service has preserveLayerIds=true and the
// bans layer id is 14, not 0 (live-verified 2026-06-11; the /0/query path in
// the catalog entry 400s with 'Invalid URL'). Server-side filter:
// FIRE_CENTRE_NAME='Coastal' (Coastal Fire Centre = Vancouver Island per the
// catalog gotcha) + VI envelope intersect — without the Coastal clause the
// envelope also drags in the giant Cariboo/Kamloops fire-centre polygons that
// merely clip the bbox's mainland corner. Worst case a handful of rows
// (1 in-filter at verify, 6 province-wide); hard-capped at 50.
//
// signals kind 'civic' (bans are access restrictions, not fires), severity
// 'watch', title 'Fire ban: <access prohibition type>'. Polygons are fire-
// centre scale (raw Coastal geometry was ~330KB at precision 5) — Turf
// simplify escalates tolerance until the stringified geometry is under 40KB
// (0.005 → ~16KB at verify). Bans are status snapshots with no per-feature
// update timestamp: observedAt = poll time, expiresAt = +24h so rescinded
// bans (deleted upstream) age off the board. Cadence: slow lane (21600s;
// upstream changes every 30-60 min at most during season).
const META: SourceMeta = {
  slug: 'bcws-bans',
  name: 'BCWS Fire Bans & Prohibitions',
  cluster: 'Wildfire',
  cadenceSec: 21600,
  attribution:
    'Contains information licensed under the Open Government Licence - British Columbia (BC Wildfire Service).',
};

const QUERY_URL =
  'https://services6.arcgis.com/ubm4tcTYICKBpist/arcgis/rest/services/British_Columbia_Bans_and_Prohibition_Areas_-_View/FeatureServer/14/query';

interface BanFeature {
  geometry: Polygon | MultiPolygon | null;
  properties: {
    PROT_BAP_SYSID: number | null;
    TYPE: string | null;
    ACCESS_PROHIBITION_DESCRIPTION: string | null;
    ACCESS_STATUS_EFFECTIVE_DATE: number | null; // epoch ms in f=geojson
    FIRE_CENTRE_NAME: string | null;
    FIRE_ZONE_NAME: string | null;
    BULLETIN_URL: string | null;
  };
}

// Aggressive Turf simplification — ban polygons are fire-centre scale and
// huge; escalate tolerance until the stringified geometry is under 40KB.
function simplifyBan(geometry: Polygon | MultiPolygon): string {
  let json = JSON.stringify(geometry);
  for (const tolerance of [0.001, 0.005, 0.02, 0.05]) {
    if (json.length <= 40_000) break;
    const feature: Feature<Polygon | MultiPolygon> = { type: 'Feature', properties: {}, geometry };
    json = JSON.stringify(
      simplify(feature, { tolerance, highQuality: false, mutate: false }).geometry,
    );
  }
  return json;
}

export const sync = internalAction({
  args: {},
  handler: async (ctx) => {
    const params = new URLSearchParams({
      where: "FIRE_CENTRE_NAME = 'Coastal'",
      outFields:
        'PROT_BAP_SYSID,TYPE,ACCESS_PROHIBITION_DESCRIPTION,ACCESS_STATUS_EFFECTIVE_DATE,FIRE_CENTRE_NAME,FIRE_ZONE_NAME,BULLETIN_URL',
      geometry: `${VI_BBOX.west},${VI_BBOX.south},${VI_BBOX.east},${VI_BBOX.north}`,
      geometryType: 'esriGeometryEnvelope',
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      outSR: '4326',
      geometryPrecision: '5',
      resultRecordCount: '50',
      f: 'geojson',
    });
    try {
      const res = await fetchSource(`${QUERY_URL}?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        features?: BanFeature[];
        error?: { code?: number; message?: string };
      };
      // ArcGIS reports query errors in a 200 body
      if (!Array.isArray(data.features))
        throw new Error(`ArcGIS error: ${data.error?.message ?? 'no features array'}`);
      const fetchedAt = Date.now();
      const expiresAt = fetchedAt + 24 * 3600 * 1000;
      const signals: SignalInput[] = [];
      const seen = new Set<string>();
      for (const f of data.features) {
        const p = f.properties;
        if (!f.geometry || p.PROT_BAP_SYSID == null) continue;
        // Belt-and-braces VI filter on top of the upstream envelope query
        const [w, s, e, n] = turfBbox(f.geometry);
        if (e < VI_BBOX.west || w > VI_BBOX.east || n < VI_BBOX.south || s > VI_BBOX.north)
          continue;
        const type = p.TYPE ?? 'Prohibition';
        const prohibition = p.ACCESS_PROHIBITION_DESCRIPTION ?? type;
        const dedupeKey = `${META.slug}:${p.PROT_BAP_SYSID}:${type}`;
        if (seen.has(dedupeKey)) continue; // in-response dupes (republished rows)
        seen.add(dedupeKey);
        const effective = p.ACCESS_STATUS_EFFECTIVE_DATE ?? undefined;
        signals.push({
          sourceSlug: META.slug,
          kind: 'civic',
          title: `Fire ban: ${prohibition}`,
          summary: `${type} · ${p.FIRE_CENTRE_NAME ?? 'Unknown'} Fire Centre${
            effective ? ` · effective ${new Date(effective).toISOString().slice(0, 10)}` : ''
          }`,
          severity: 'watch',
          geojson: JSON.stringify({
            type: 'Feature',
            geometry: JSON.parse(simplifyBan(f.geometry)),
            properties: { type, prohibition, fireCentre: p.FIRE_CENTRE_NAME },
          }),
          startsAt: effective,
          observedAt: fetchedAt,
          expiresAt,
          dedupeKey,
          confidence: 1.0, // authoritative agency (BCWS)
          provenance: JSON.stringify({
            method: 'poll',
            fetchedAt,
            upstreamId: String(p.PROT_BAP_SYSID),
            url: p.BULLETIN_URL ?? undefined,
          }),
          raw: JSON.stringify({
            type,
            prohibition,
            fireCentre: p.FIRE_CENTRE_NAME,
            fireZone: p.FIRE_ZONE_NAME,
            effectiveDate: effective ? new Date(effective).toISOString() : null,
            bulletinUrl: p.BULLETIN_URL,
          }),
        });
      }
      await ctx.runMutation(internal.feeds.bcwsBans.ingest, { signals });
    } catch (e) {
      await ctx.runMutation(internal.feeds.bcwsBans.fail, { error: String(e) });
    }
  },
});

export const ingest = internalMutation({
  args: { signals: v.array(v.any()) },
  handler: async (ctx, { signals }) => {
    const { inserted, updated } = await upsertSignals(ctx, signals);
    await reportSuccess(ctx, META, signals.length);
    return { inserted, updated };
  },
});

export const fail = internalMutation({
  args: { error: v.string() },
  handler: async (ctx, { error }) => {
    await reportFailure(ctx, META, error);
  },
});
