import { v } from 'convex/values';
import { internalAction, internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { fetchSource } from '../lib/fetchSource';
import { cellOf } from '../lib/geo';
import {
  insertReadings,
  upsertSignals,
  reportSuccess,
  reportFailure,
  type ReadingInput,
  type SignalInput,
  type SourceMeta,
} from '../lib/ingest';
import { writeSnapshot } from '../lib/movers';

// bc-drought — SOURCES.md: Environment & Conditions. BC Drought Information
// Portal ArcGIS FeatureServer (layer 27, not 0 — /0 is a 400). No auth.
// Crown copyright 'Access Only': display in this single-operator dashboard
// only, never redistribute. Envelope intersect returns mainland basins too —
// filter to the two VI BasinNames server-side. Updates roughly weekly.
// Worst case 2 readings + 2 signals + 1 snapshot per sync. Cadence: 43200s.
const META: SourceMeta = {
  slug: 'bc-drought',
  name: 'BC Drought Levels',
  cluster: 'Environment & Conditions',
  cadenceSec: 43200,
  attribution: 'Province of British Columbia, BC Drought Information Portal',
  licenseNote: 'Access Only (Crown copyright) — display only, do not redistribute',
};

const URL_ATTRS =
  'https://services1.arcgis.com/xeMpV7tU1t4KD3Ei/arcgis/rest/services/' +
  'British_Columbia_Drought_Levels_(Edit)_view/FeatureServer/27/query' +
  '?where=1%3D1&outFields=*&geometry=-125.3,48.2,-123.1,51.1' +
  '&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects' +
  '&returnGeometry=false&f=json';

// Fixed display anchors (basin polygons are huge; the map layer just needs a
// stable point per basin, kept inside VI_BBOX). East = Horne Lake area on the
// eastern slope; West = Great Central Lake, which drains west via the Somass.
const BASINS = [
  { name: 'East Vancouver Island', id: 'east-vancouver-island', lat: 49.05, lng: -124.3 },
  { name: 'West Vancouver Island', id: 'west-vancouver-island', lat: 49.35, lng: -125.2 },
] as const;

const SIGNAL_TTL_MS = 7 * 24 * 3600 * 1000;

interface DroughtFeature {
  attributes: {
    OBJECTID: number;
    BasinName: string | null;
    // 0–5 per the coded-value domain; 99 = 'Not updated outside of core
    // drought season' (observed in the live domain) — treated as no data.
    DroughtLevel: number | null;
    Date_Modified: number | null; // epoch ms
    Comments: string | null;
  };
}

export const sync = internalAction({
  args: {},
  handler: async (ctx) => {
    try {
      const res = await fetchSource(URL_ATTRS);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        features?: DroughtFeature[];
        error?: { code: number; message: string };
      };
      // ArcGIS reports errors as 200 + {error} JSON.
      if (data.error) throw new Error(`ArcGIS ${data.error.code}: ${data.error.message}`);
      const fetchedAt = Date.now();

      const readings: ReadingInput[] = [];
      const signals: SignalInput[] = [];
      const stations: Array<{
        id: string;
        label: string;
        lat: number;
        lng: number;
        value: number | null;
        unit: string;
        at: number;
      }> = [];

      for (const basin of BASINS) {
        const feat = (data.features ?? []).find((f) => f.attributes.BasinName === basin.name);
        if (!feat) continue; // basin missing upstream — skip, keep the other
        const { DroughtLevel, Date_Modified, Comments } = feat.attributes;
        const at = Date_Modified ?? fetchedAt;
        // 99 / null = not maintained off-season → station shown with no value.
        const level =
          DroughtLevel !== null && DroughtLevel >= 0 && DroughtLevel <= 5 ? DroughtLevel : null;
        if (level !== null) {
          readings.push({
            stationId: `${META.slug}:${basin.id}`,
            metric: 'drought_level',
            value: level,
            unit: 'level',
            at,
            lat: basin.lat,
            lng: basin.lng,
            sourceSlug: META.slug,
          });
        }
        stations.push({
          id: basin.id,
          label: basin.name,
          lat: basin.lat,
          lng: basin.lng,
          value: level,
          unit: 'level',
          at,
        });
        // Severity mapping: BC drought classification 0–5 (DroughtLevel coded
        // domain). Levels 4–5 = adverse impacts likely/almost certain → watch
        // (per spec); 0–3 emit no signal. Signal stops being refreshed when
        // the level drops, and ages out via expiresAt.
        if (level !== null && level >= 4) {
          signals.push({
            sourceSlug: META.slug,
            kind: 'civic',
            title: `Drought Level ${level} — ${basin.name}`,
            summary: Comments?.slice(0, 300) ?? undefined,
            severity: 'watch',
            lat: basin.lat,
            lng: basin.lng,
            cell: cellOf(basin.lat, basin.lng),
            observedAt: at,
            expiresAt: fetchedAt + SIGNAL_TTL_MS,
            dedupeKey: `${META.slug}:${basin.id}`,
            confidence: 1.0,
            provenance: JSON.stringify({
              method: 'poll',
              fetchedAt,
              upstreamId: String(feat.attributes.OBJECTID),
              url: 'https://droughtportal.gov.bc.ca/',
            }),
            raw: JSON.stringify({ basin: basin.name, level, dateModified: Date_Modified }),
          });
        }
      }

      await ctx.runMutation(internal.feeds.bcDrought.ingest, {
        readings,
        signals,
        snapshotJson: JSON.stringify(stations),
      });
    } catch (e) {
      await ctx.runMutation(internal.feeds.bcDrought.fail, { error: String(e) });
    }
  },
});

export const ingest = internalMutation({
  args: { readings: v.array(v.any()), signals: v.array(v.any()), snapshotJson: v.string() },
  handler: async (ctx, { readings, signals, snapshotJson }) => {
    const readingsInserted = await insertReadings(ctx, readings as ReadingInput[]);
    const { inserted, updated } = await upsertSignals(ctx, signals as SignalInput[]);
    await writeSnapshot(ctx, `stations:${META.slug}`, snapshotJson);
    await reportSuccess(ctx, META, readings.length + signals.length);
    return { readingsInserted, inserted, updated };
  },
});

export const fail = internalMutation({
  args: { error: v.string() },
  handler: async (ctx, { error }) => {
    await reportFailure(ctx, META, error);
  },
});
