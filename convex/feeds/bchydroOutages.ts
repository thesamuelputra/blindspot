import { v } from 'convex/values';
import { simplify } from '@turf/turf';
import type { Feature, Polygon } from 'geojson';
import { internalAction, internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { fetchSource } from '../lib/fetchSource';
import { inBbox, cellOf, onIslandSide } from '../lib/geo';
import { upsertSignals, reportSuccess, reportFailure, type SourceMeta } from '../lib/ingest';

// bchydro-outages — SOURCES.md: Ground (Mobility). Undocumented JSON behind the
// public outage map (no auth, Akamai-cached, no contract stability — credit
// BC Hydro). Top-level array, province-wide; VI-bbox filtered server-side.
// Worst case ~1,500 rows province-wide in a major windstorm, of which the VI
// subset is ~400 records/sync.
const META: SourceMeta = {
  slug: 'bchydro-outages',
  name: 'BC Hydro Outage Map',
  cluster: 'Ground (Mobility)',
  cadenceSec: 300,
  attribution: 'BC Hydro',
  licenseNote: 'Undocumented internal endpoint; no open-data license — display-only, credit BC Hydro',
};

const ENDPOINT = 'https://www.bchydro.com/power-outages/app/outages-map-data.json';

// Severity from upstream `numCustomersOut` (customers affected):
// >= 1000 → warning, >= 50 → watch, else info. Outages never map to critical —
// escalation beyond warning is the brain's job (e.g. outage × cold snap).
const SEVERITY = (customers: number): 'info' | 'watch' | 'warning' | 'critical' =>
  customers >= 1000 ? 'warning' : customers >= 50 ? 'watch' : 'info';

// Observed upstream shape (verified live 2026-06-11): flat array of outages,
// epoch-ms timestamps, `polygon` is a FLAT alternating [lng,lat,...] ring.
interface Outage {
  id: number;
  municipality: string | null;
  area: string | null;
  cause: string | null;
  numCustomersOut: number | null;
  crewStatus: string | null;
  crewStatusDescription: string | null;
  crewEta: number | null;
  crewEtr: number | null;
  dateOff: number | null;
  dateOn: number | null;
  lastUpdated: number | null;
  showEta: boolean;
  showEtr: boolean;
  showDateOn: boolean;
  latitude: number;
  longitude: number;
  polygon: number[] | null;
}

// Flat [lng,lat,...] ring → closed GeoJSON Polygon Feature (SOURCES.md gotcha:
// not GeoJSON upstream). Rings observed at ~37 points avg / 45 max; Turf-
// simplify only oversized ones to respect the size-discipline rule.
function ringToGeojson(flat: number[], outageId: number): string | undefined {
  if (flat.length < 6 || flat.length % 2 !== 0) return undefined;
  const ring: [number, number][] = [];
  for (let i = 0; i < flat.length; i += 2) ring.push([flat[i], flat[i + 1]]);
  const [fx, fy] = ring[0];
  const [lx, ly] = ring[ring.length - 1];
  if (fx !== lx || fy !== ly) ring.push([fx, fy]);
  let feature: Feature<Polygon> = {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [ring] },
    properties: { outageId },
  };
  if (ring.length > 80) {
    try {
      feature = simplify(feature, { tolerance: 0.0002, highQuality: false });
    } catch {
      // keep the unsimplified ring — still small enough to store
    }
  }
  return JSON.stringify(feature);
}

export const sync = internalAction({
  args: {},
  handler: async (ctx) => {
    try {
      const res = await fetchSource(ENDPOINT);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const outages = (await res.json()) as Outage[];
      const fetchedAt = Date.now();
      const signals = outages
        .filter(
          (o) =>
            typeof o.latitude === 'number' &&
            typeof o.longitude === 'number' &&
            inBbox(o.latitude, o.longitude) &&
            // trim the Metro Van corner the raw bbox admits (AUDIT Phase 6)
            onIslandSide(o.latitude, o.longitude),
        )
        .map((o) => {
          const customers = o.numCustomersOut ?? 0;
          // expiresAt from the estimated restore time: crewEtr gated by showEtr
          // (SOURCES.md gotcha — ETA is crew arrival, ETR is restore); planned
          // work publishes dateOn (gated by showDateOn) instead.
          const expiresAt =
            o.showEtr && o.crewEtr ? o.crewEtr : o.showDateOn && o.dateOn ? o.dateOn : undefined;
          return {
            sourceSlug: META.slug,
            kind: 'outage',
            title: `${o.municipality ?? 'Unknown area'} — ${customers} customer${customers === 1 ? '' : 's'} out`,
            summary:
              [o.area, o.cause, o.crewStatusDescription].filter(Boolean).join(' · ') || undefined,
            severity: SEVERITY(customers),
            lat: o.latitude,
            lng: o.longitude,
            cell: cellOf(o.latitude, o.longitude),
            geojson: o.polygon ? ringToGeojson(o.polygon, o.id) : undefined,
            startsAt: o.dateOff ?? undefined,
            // upstream lastUpdated, so the upsert refreshes active outages
            observedAt: o.lastUpdated ?? o.dateOff ?? fetchedAt,
            expiresAt,
            dedupeKey: `bchydro:${o.id}`, // stable upstream outage id
            confidence: 1.0, // authoritative utility — BC Hydro's own outage system
            provenance: JSON.stringify({
              method: 'poll',
              fetchedAt,
              upstreamId: String(o.id),
              url: ENDPOINT,
            }),
            raw: JSON.stringify({
              customersAffected: customers,
              cause: o.cause,
              crewStatus: o.crewStatus,
            }),
          };
        });
      await ctx.runMutation(internal.feeds.bchydroOutages.ingest, { signals });
    } catch (e) {
      await ctx.runMutation(internal.feeds.bchydroOutages.fail, { error: String(e) });
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
