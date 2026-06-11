import { v } from 'convex/values';
import { internalAction, internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { fetchSource } from '../lib/fetchSource';
import { cellOf } from '../lib/geo';
import {
  upsertSignals,
  reportSuccess,
  reportFailure,
  type SignalInput,
  type SourceMeta,
} from '../lib/ingest';

// bc-rfc-advisories — SOURCES.md: Environment & Conditions. The RFC warnings
// web page is HTML+PDF with a broken TLS chain — the machine path is the
// public ArcGIS FeatureServer behind the provincial flood map. No auth.
// Two-step poll keeps polygons off the wire in fair weather: (1) cheap
// attributes-only status query for the VI basins, (2) geometry fetched only
// for rows with an active advisory, simplified server-side via
// maxAllowableOffset (≈5 km, interpreted in the layer's Web Mercator metres —
// verified: all 5 major basins simplify to ~4.6 KB total at precision 3).
// All basins Advisory=1 (No Advisory) → 0 signals, success. Worst case ~46 VI
// rows active at once → ~46 signals. Cadence: 3600s.
const META: SourceMeta = {
  slug: 'bc-rfc-advisories',
  name: 'BC River Forecast Centre Flood Advisories',
  cluster: 'Environment & Conditions',
  cadenceSec: 3600,
  attribution: 'BC River Forecast Centre, Province of British Columbia',
};

const BASE =
  'https://services6.arcgis.com/ubm4tcTYICKBpist/arcgis/rest/services/' +
  'BC_Flood_Advisory_and_Warning_Notifications_(Public_View)/FeatureServer/0/query';

const ATTRS_URL =
  `${BASE}?where=Major_Basin+LIKE+'%25Vancouver+Island%25'` +
  '&outFields=OBJECTID,Major_Basin,Sub_Basin,Basin_Type,Advisory,Date_Modified,Comments' +
  '&returnGeometry=false&f=json';

const SIGNAL_TTL_MS = 24 * 3600 * 1000; // hourly poll; lifted advisories age out within a day

// Advisory coded-value domain → severity (documented mapping, per spec):
//   2 High Streamflow Advisory → watch
//   3 Flood Watch              → watch
//   4 Flood Warning            → warning
//   1 No Advisory              → no signal
const ADVISORY_NAME: Record<number, string> = {
  2: 'High Streamflow Advisory',
  3: 'Flood Watch',
  4: 'Flood Warning',
};
const ADVISORY_SEVERITY: Record<number, SignalInput['severity']> = {
  2: 'watch',
  3: 'watch',
  4: 'warning',
};

interface RfcAttrs {
  OBJECTID: number;
  Major_Basin: string | null;
  Sub_Basin: string | null;
  Basin_Type: 'N' | 'Y' | null; // N = major basin, Y = sub-basin
  Advisory: number | null;
  Date_Modified: number | null; // epoch ms
  Comments: string | null;
}

type GeoJsonGeometry = { type: string; coordinates: unknown };

// Bbox-midpoint of every position in a (Multi)Polygon — a cheap anchor for
// proximity (cell) without a turf dependency.
function centroidOf(geom: GeoJsonGeometry): { lat: number; lng: number } | null {
  let minLat = Infinity,
    maxLat = -Infinity,
    minLng = Infinity,
    maxLng = -Infinity;
  let seen = false;
  const walk = (node: unknown): void => {
    if (!Array.isArray(node)) return;
    if (node.length >= 2 && typeof node[0] === 'number' && typeof node[1] === 'number') {
      const [lng, lat] = node as [number, number];
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
      minLng = Math.min(minLng, lng);
      maxLng = Math.max(maxLng, lng);
      seen = true;
      return;
    }
    for (const child of node) walk(child);
  };
  walk(geom.coordinates);
  return seen ? { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 } : null;
}

export const sync = internalAction({
  args: {},
  handler: async (ctx) => {
    try {
      const res = await fetchSource(ATTRS_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        features?: Array<{ attributes: RfcAttrs }>;
        error?: { code: number; message: string };
      };
      if (data.error) throw new Error(`ArcGIS ${data.error.code}: ${data.error.message}`);
      const fetchedAt = Date.now();

      const active = (data.features ?? [])
        .map((f) => f.attributes)
        .filter((a) => (a.Advisory ?? 1) >= 2);

      // Geometry only for active rows — best-effort: a geometry failure must
      // not drop the (time-critical) advisory signals themselves.
      const geometries = new Map<number, GeoJsonGeometry>();
      if (active.length > 0) {
        try {
          const ids = active.map((a) => a.OBJECTID).join(',');
          const geoUrl =
            `${BASE}?where=OBJECTID+IN+(${ids})&outFields=OBJECTID&returnGeometry=true` +
            '&f=geojson&outSR=4326&geometryPrecision=3&maxAllowableOffset=5000';
          const geoRes = await fetchSource(geoUrl);
          if (geoRes.ok) {
            const geo = (await geoRes.json()) as {
              features?: Array<{ id?: number; geometry: GeoJsonGeometry | null }>;
            };
            for (const f of geo.features ?? []) {
              if (typeof f.id === 'number' && f.geometry) geometries.set(f.id, f.geometry);
            }
          }
        } catch {
          // geometry is decoration; signals proceed without it
        }
      }

      const signals: SignalInput[] = active.map((a) => {
        const level = a.Advisory ?? 2;
        const name = ADVISORY_NAME[level] ?? `Advisory level ${level}`;
        const place = a.Sub_Basin ?? a.Major_Basin ?? 'Vancouver Island basin';
        const geom = geometries.get(a.OBJECTID);
        const centroid = geom ? centroidOf(geom) : null;
        return {
          sourceSlug: META.slug,
          kind: 'civic',
          title: `${name} — ${place}`,
          summary: a.Comments?.slice(0, 300) ?? undefined,
          severity: ADVISORY_SEVERITY[level] ?? 'warning',
          lat: centroid?.lat,
          lng: centroid?.lng,
          cell: centroid ? cellOf(centroid.lat, centroid.lng) : undefined,
          geojson: geom ? JSON.stringify(geom) : undefined,
          observedAt: a.Date_Modified ?? fetchedAt,
          expiresAt: fetchedAt + SIGNAL_TTL_MS,
          dedupeKey: `${META.slug}:${a.OBJECTID}`,
          confidence: 1.0,
          provenance: JSON.stringify({
            method: 'poll',
            fetchedAt,
            upstreamId: String(a.OBJECTID),
            url: 'https://bcrfc.env.gov.bc.ca/warnings/',
          }),
          raw: JSON.stringify({
            majorBasin: a.Major_Basin,
            subBasin: a.Sub_Basin,
            basinType: a.Basin_Type,
            advisory: level,
            dateModified: a.Date_Modified,
          }).slice(0, 2000),
        };
      });

      await ctx.runMutation(internal.feeds.bcRfcAdvisories.ingest, { signals });
    } catch (e) {
      await ctx.runMutation(internal.feeds.bcRfcAdvisories.fail, { error: String(e) });
    }
  },
});

export const ingest = internalMutation({
  args: { signals: v.array(v.any()) },
  handler: async (ctx, { signals }) => {
    const result = await upsertSignals(ctx, signals as SignalInput[]);
    await reportSuccess(ctx, META, signals.length);
    return result;
  },
});

export const fail = internalMutation({
  args: { error: v.string() },
  handler: async (ctx, { error }) => {
    await reportFailure(ctx, META, error);
  },
});
