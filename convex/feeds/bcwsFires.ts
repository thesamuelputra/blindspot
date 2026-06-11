import { v } from 'convex/values';
import { simplify } from '@turf/turf';
import { internalAction, internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { fetchSource } from '../lib/fetchSource';
import { VI_BBOX, inBbox, cellOf } from '../lib/geo';
import {
  upsertSignals,
  reportSuccess,
  reportFailure,
  type SourceMeta,
  type SignalInput,
} from '../lib/ingest';

// bcws-fires — SOURCES.md: Wildfire. GeoBC ArcGIS FeatureServer (recommended
// primary per catalog; openmaps WFS is the fallback), f=geojson, 4326 envelope
// over VI bbox, no auth. Two layers per sync: active fire POINTS + current fire
// PERIMETER polygons, both filtered FIRE_STATUS <> 'Out' upstream. Worst case
// ≤250 points + ≤50 perimeters = 300 records/sync (resultRecordCount caps;
// live check 2026-06-11 saw 41 points / 7 perimeters in-bbox, 2 non-Out).
// Cadence: medium lane (900s).
const META: SourceMeta = {
  slug: 'bcws-fires',
  name: 'BC Wildfire Service',
  cluster: 'Wildfire',
  cadenceSec: 900,
  attribution:
    'Contains information licensed under the Open Government Licence - British Columbia (BC Wildfire Service).',
};

const ARCGIS_HOST = 'https://services6.arcgis.com/ubm4tcTYICKBpist/arcgis/rest/services';

// Severity from upstream FIRE_STATUS (points) / FIRE_STATUS (perimeters) plus
// size in hectares (CURRENT_SIZE / FIRE_SIZE_HECTARES):
//   'Out of Control' and > 100 ha → critical
//   'Out of Control'              → warning
//   'New' / 'Being Held'          → watch  (new starts are unassessed)
//   'Under Control' / 'Out'       → info
// FIRE_OF_NOTE_IND === 'Y' floors severity at warning (BCWS "fire of note").
function severityOf(
  status: string | null,
  hectares: number,
  fireOfNote: boolean,
): 'info' | 'watch' | 'warning' | 'critical' {
  const s = (status ?? '').toLowerCase();
  let sev: 'info' | 'watch' | 'warning' | 'critical';
  if (s === 'out of control') sev = hectares > 100 ? 'critical' : 'warning';
  else if (s === 'new' || s === 'being held') sev = 'watch';
  else sev = 'info';
  if (fireOfNote && (sev === 'info' || sev === 'watch')) sev = 'warning';
  return sev;
}

// Minimal structural GeoJSON types (convex tsconfig pins ambient types to
// node, so the global GeoJSON namespace is unavailable here).
interface Geometry {
  type: string;
  coordinates: unknown;
}
interface FeatureCollection<P> {
  features?: Array<{ geometry: Geometry | null; properties: P }>;
  error?: { code?: number; message?: string };
}
interface PointProps {
  FIRE_NUMBER: string | null;
  FIRE_YEAR: number | null;
  FIRE_STATUS: string | null;
  CURRENT_SIZE: number | null;
  IGNITION_DATE: number | null; // epoch ms
  GEOGRAPHIC_DESCRIPTION: string | null;
  INCIDENT_NAME: string | null;
  FIRE_URL: string | null;
  FIRE_OF_NOTE_IND: string | null;
}
interface PerimProps {
  FIRE_NUMBER: string | null;
  FIRE_YEAR: number | null;
  FIRE_STATUS: string | null;
  FIRE_SIZE_HECTARES: number | null;
  TRACK_DATE: number | null; // epoch ms, when the perimeter was mapped
  FIRE_URL: string | null;
}

function queryUrl(service: string, resultRecordCount: number): string {
  const params = new URLSearchParams({
    where: "FIRE_STATUS <> 'Out'",
    geometry: `${VI_BBOX.west},${VI_BBOX.south},${VI_BBOX.east},${VI_BBOX.north}`,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: '*',
    returnGeometry: 'true',
    outSR: '4326',
    resultRecordCount: String(resultRecordCount),
    f: 'geojson',
  });
  return `${ARCGIS_HOST}/${service}/FeatureServer/0/query?${params.toString()}`;
}

// Turf simplify (tolerance ~0.001 ≈ 100m at this latitude) — perimeters come
// in at GPS vertex density (thousands of points). Falls back to the original
// geometry if simplify rejects it.
function simplifyGeometry(geometry: Geometry): Geometry {
  try {
    const feature = { type: 'Feature', properties: {}, geometry } as Parameters<
      typeof simplify
    >[0];
    const out = simplify(feature, { tolerance: 0.001, highQuality: false }) as {
      geometry: Geometry;
    };
    return out.geometry;
  } catch {
    return geometry;
  }
}

async function fetchGeojson<P>(url: string): Promise<FeatureCollection<P>> {
  const res = await fetchSource(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as FeatureCollection<P>;
  // ArcGIS reports errors as 200 + {error} body
  if (data.error) throw new Error(`ArcGIS error ${data.error.code}: ${data.error.message}`);
  return data;
}

export const sync = internalAction({
  args: {},
  handler: async (ctx) => {
    try {
      const [points, perims] = await Promise.all([
        fetchGeojson<PointProps>(queryUrl('BCWS_ActiveFires_PublicView', 250)),
        fetchGeojson<PerimProps>(queryUrl('BCWS_FirePerimeters_PublicView', 50)),
      ]);
      const fetchedAt = Date.now();
      // BCWS rows are current-status snapshots with no per-feature update
      // timestamp, so observedAt = poll time (refreshed by the dedupe upsert
      // every sync); fires drop off the board ≤24h after going Out upstream.
      const expiresAt = fetchedAt + 24 * 3600 * 1000;
      const signals: SignalInput[] = [];

      for (const f of points.features ?? []) {
        const p = f.properties;
        const coords = f.geometry?.coordinates as [number, number] | undefined;
        if (!p.FIRE_NUMBER || !coords) continue;
        const [lng, lat] = coords;
        if (!inBbox(lat, lng)) continue; // envelope intersect ≈ bbox, but be exact
        const hectares = p.CURRENT_SIZE ?? 0;
        signals.push({
          sourceSlug: META.slug,
          kind: 'wildfire',
          title: `Fire ${p.FIRE_NUMBER} — ${p.GEOGRAPHIC_DESCRIPTION ?? p.INCIDENT_NAME ?? 'unknown location'}`,
          summary: `${p.FIRE_STATUS ?? 'Unknown status'} · ${hectares} ha`,
          severity: severityOf(p.FIRE_STATUS, hectares, p.FIRE_OF_NOTE_IND === 'Y'),
          lat,
          lng,
          cell: cellOf(lat, lng),
          observedAt: fetchedAt,
          expiresAt,
          dedupeKey: `${META.slug}:${p.FIRE_YEAR}-${p.FIRE_NUMBER}`,
          confidence: 1.0, // authoritative agency (BCWS)
          provenance: JSON.stringify({
            method: 'poll',
            fetchedAt,
            upstreamId: p.FIRE_NUMBER,
            url: p.FIRE_URL ?? undefined,
          }),
          raw: JSON.stringify({
            hectares,
            status: p.FIRE_STATUS,
            discoveryDate: p.IGNITION_DATE ? new Date(p.IGNITION_DATE).toISOString() : null,
          }),
        });
      }

      for (const f of perims.features ?? []) {
        const p = f.properties;
        if (!p.FIRE_NUMBER || !f.geometry) continue;
        const hectares = p.FIRE_SIZE_HECTARES ?? 0;
        const geometry = simplifyGeometry(f.geometry);
        signals.push({
          sourceSlug: META.slug,
          kind: 'wildfire',
          title: `Fire ${p.FIRE_NUMBER} — perimeter (${hectares} ha)`,
          summary: `${p.FIRE_STATUS ?? 'Unknown status'} · perimeter mapped ${
            p.TRACK_DATE ? new Date(p.TRACK_DATE).toISOString().slice(0, 10) : 'n/a'
          }`,
          severity: severityOf(p.FIRE_STATUS, hectares, false),
          geojson: JSON.stringify({
            type: 'Feature',
            geometry,
            properties: { fireNumber: p.FIRE_NUMBER, status: p.FIRE_STATUS, hectares },
          }),
          observedAt: fetchedAt,
          expiresAt,
          // shares the fire's dedupeKey with the ':perim' suffix
          dedupeKey: `${META.slug}:${p.FIRE_YEAR}-${p.FIRE_NUMBER}:perim`,
          confidence: 1.0, // authoritative agency (BCWS)
          provenance: JSON.stringify({
            method: 'poll',
            fetchedAt,
            upstreamId: `${p.FIRE_NUMBER}:perim`,
            url: p.FIRE_URL ?? undefined,
          }),
          raw: JSON.stringify({
            hectares,
            status: p.FIRE_STATUS,
            trackDate: p.TRACK_DATE ? new Date(p.TRACK_DATE).toISOString() : null,
          }),
        });
      }

      await ctx.runMutation(internal.feeds.bcwsFires.ingest, { signals });
    } catch (e) {
      await ctx.runMutation(internal.feeds.bcwsFires.fail, { error: String(e) });
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
