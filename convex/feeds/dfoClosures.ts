import { v } from 'convex/values';
import { internalAction, internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { fetchSource } from '../lib/fetchSource';
import { VI_BBOX, cellOf } from '../lib/geo';
import {
  upsertSignals,
  reportSuccess,
  reportFailure,
  type SourceMeta,
  type SignalInput,
} from '../lib/ingest';
import { bbox as turfBbox, simplify } from '@turf/turf';
import type { Feature, MultiPolygon, Polygon } from 'geojson';

// dfo-closures — SOURCES.md: Seas (Marine). DFO CSSP 'Active Prohibition
// Orders' ArcGIS layer (egisp host — the old gisp host is NXDOMAIN), no auth,
// biotoxin/sanitary/chemical shellfish closures as polygons. One signal per
// prohibition order (PO_NUM): the layer publishes one feature per subarea
// (439 features / 192 orders in the VI bbox at build, 2026-06-11), so member
// polygons are merged into a MultiPolygon and deduped by closure id.
// maxAllowableOffset generalizes server-side (full-res pull is 11MB+ and times
// out; at 0.0005° it is ~1.2MB in ~5s). Worst case ≤200 signals/sync (cap).
// Cadence: slow lane (86400s) — closures change on regulatory timescales.
const META: SourceMeta = {
  slug: 'dfo-closures',
  name: 'DFO CSSP Shellfish Closures',
  cluster: 'Seas (Marine)',
  cadenceSec: 86400,
  attribution: 'Fisheries and Oceans Canada — Open Government Licence - Canada',
};

const QUERY_URL = 'https://egisp.dfo-mpo.gc.ca/arcgis/rest/services/CSSP/Data_Public/MapServer/3/query';

// Signals stay visible while the order remains in the active layer (observedAt
// refreshes every sync); revoked orders vanish upstream, stop refreshing, and
// age out of the client window. expiresAt covers a few missed syncs.
const EXPIRE_MS = 3 * 24 * 3600 * 1000;
const MAX_SIGNALS = 200;
const GEOJSON_BUDGET = 50_000;

// REASON coded-value domain from the layer metadata (verified 2026-06-11),
// compacted to the English half of the bilingual labels.
const REASON_LABELS: Record<number, string> = {
  1: 'Biotoxin',
  2: 'Biotoxin monitoring ceased',
  3: 'Chemical',
  4: 'Sanitary (conditionally approved)',
  5: 'Sanitary (emergency)',
  6: 'Sanitary (shellstock)',
  7: 'Sanitary (water quality)',
  8: 'Sanitary and biotoxin',
  9: 'Conservation',
  10: 'Sanitary (conditionally restricted)',
};

interface ClosureFeature {
  geometry: Polygon | MultiPolygon | null;
  properties: {
    OBJECTID: number;
    REASON: number | null;
    PO_NUM: string | null;
    PLACE_NAME_EN: string | null;
    GEO_SHORT_DESCRIPTION_EN: string | null;
    SPECIES_DESCRIPTION_EN: string | null;
    ISSUANCE_DATE: number | null;
    ENFORCE_DATE: number | null;
    PUBLIC_NOTICE_URL: string | null;
  };
}

interface OrderGroup {
  poNum: string;
  reason: number | null;
  species: string | null;
  noticeUrl: string | null;
  startsAt: number | null;
  places: string[];
  polygons: Polygon['coordinates'][];
}

// Escalating Turf simplification on top of the server-side generalization —
// the largest merged order was ~58KB at build; keep stored geojson ≤50KB.
// turf simplify can throw ("fewer than 4 points") when its cleanCoords pass
// collapses small near-collinear rings — verified against live data — so a
// throw falls back to the last good stringification rather than failing sync.
function simplifyGeometry(geometry: MultiPolygon): string {
  let json = JSON.stringify(geometry);
  for (const tolerance of [0.0005, 0.002, 0.008, 0.03]) {
    if (json.length <= GEOJSON_BUDGET) break;
    try {
      const feature: Feature<MultiPolygon> = { type: 'Feature', properties: {}, geometry };
      json = JSON.stringify(simplify(feature, { tolerance, highQuality: false, mutate: false }).geometry);
    } catch {
      break; // keep the un-simplified (server-generalized) geometry
    }
  }
  return json;
}

export const sync = internalAction({
  args: {},
  handler: async (ctx) => {
    const params = new URLSearchParams({
      where: '1=1',
      geometry: `${VI_BBOX.west},${VI_BBOX.south},${VI_BBOX.east},${VI_BBOX.north}`,
      geometryType: 'esriGeometryEnvelope',
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      outFields:
        'OBJECTID,REASON,PO_NUM,PLACE_NAME_EN,GEO_SHORT_DESCRIPTION_EN,SPECIES_DESCRIPTION_EN,ISSUANCE_DATE,ENFORCE_DATE,PUBLIC_NOTICE_URL',
      returnGeometry: 'true',
      geometryPrecision: '4',
      maxAllowableOffset: '0.0005',
      f: 'geojson',
      resultRecordCount: '2000',
    });
    try {
      const res = await fetchSource(`${QUERY_URL}?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        features?: ClosureFeature[];
        error?: { message?: string };
      };
      // ArcGIS reports query errors in a 200 body
      if (!Array.isArray(data.features)) {
        throw new Error(`ArcGIS error: ${data.error?.message ?? 'no features array'}`);
      }
      const fetchedAt = Date.now();

      // Group subarea features by prohibition order (PO_NUM)
      const groups = new Map<string, OrderGroup>();
      for (const f of data.features) {
        const poNum = f.properties.PO_NUM;
        if (!f.geometry || !poNum) continue;
        // Belt-and-braces VI filter on top of the upstream envelope query
        const [w, s, e, n] = turfBbox(f.geometry);
        if (e < VI_BBOX.west || w > VI_BBOX.east || n < VI_BBOX.south || s > VI_BBOX.north) continue;
        const p = f.properties;
        let g = groups.get(poNum);
        if (!g) {
          g = {
            poNum,
            reason: p.REASON,
            species: p.SPECIES_DESCRIPTION_EN,
            noticeUrl: p.PUBLIC_NOTICE_URL,
            startsAt: p.ENFORCE_DATE ?? p.ISSUANCE_DATE,
            places: [],
            polygons: [],
          };
          groups.set(poNum, g);
        }
        if (p.PLACE_NAME_EN) g.places.push(p.PLACE_NAME_EN);
        // Drop rings the server-side generalization collapsed below 4 points
        const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
        for (const poly of polys) {
          const rings = poly.filter((ring) => ring.length >= 4);
          if (rings.length > 0) g.polygons.push(rings);
        }
      }

      const signals: SignalInput[] = [];
      for (const g of groups.values()) {
        if (g.polygons.length === 0) continue;
        const merged: MultiPolygon = { type: 'MultiPolygon', coordinates: g.polygons };
        const [w, s, e, n] = turfBbox(merged);
        const lat = (s + n) / 2;
        const lng = (w + e) / 2;
        const reasonLabel = g.reason !== null ? (REASON_LABELS[g.reason] ?? `Reason ${g.reason}`) : 'Unspecified';
        const placeList = g.places.slice(0, 8).join(', ');
        const more = g.places.length > 8 ? ` (+${g.places.length - 8} more)` : '';
        const summary = [
          g.places.length > 0 ? `Subareas ${placeList}${more}` : null,
          g.species ? g.species.trim() : null,
        ]
          .filter(Boolean)
          .join(' · ')
          .slice(0, 300);
        signals.push({
          sourceSlug: META.slug,
          kind: 'closure-fishery',
          title: `Shellfish closure — ${reasonLabel} (${g.poNum})`,
          summary: summary || undefined,
          // Severity mapping: every feature in the Active Prohibition Orders
          // layer is a standing regulatory closure (REASON domain: biotoxin /
          // sanitary / chemical / conservation), not an acute hazard → info.
          severity: 'info',
          lat,
          lng,
          cell: cellOf(lat, lng),
          geojson: simplifyGeometry(merged),
          startsAt: g.startsAt ?? undefined,
          observedAt: fetchedAt,
          expiresAt: fetchedAt + EXPIRE_MS,
          dedupeKey: `${META.slug}:${g.poNum}`,
          confidence: 1.0, // authoritative agency (DFO)
          provenance: JSON.stringify({
            method: 'poll',
            fetchedAt,
            upstreamId: g.poNum,
            url: g.noticeUrl ?? QUERY_URL,
          }),
          raw: JSON.stringify({
            poNum: g.poNum,
            reason: g.reason,
            reasonLabel,
            subareas: g.places.length,
            species: g.species?.trim().slice(0, 200),
          }),
        });
      }

      // Cap 200/sync — keep the most recently enforced orders if exceeded
      // (192 orders in-bbox at build).
      signals.sort((a, b) => (b.startsAt ?? 0) - (a.startsAt ?? 0));
      await ctx.runMutation(internal.feeds.dfoClosures.ingest, {
        signals: signals.slice(0, MAX_SIGNALS),
      });
    } catch (e) {
      await ctx.runMutation(internal.feeds.dfoClosures.fail, { error: String(e) });
    }
  },
});

export const ingest = internalMutation({
  args: { signals: v.array(v.any()) },
  handler: async (ctx, args) => {
    const signals = args.signals as SignalInput[];
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
