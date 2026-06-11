import { v } from 'convex/values';
import { internalAction, internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { fetchSource } from '../lib/fetchSource';
import { VI_BBOX, inBbox } from '../lib/geo';
import { reportSuccess, reportFailure, type SourceMeta } from '../lib/ingest';
import { writeSnapshot } from '../lib/movers';

// open-charge-map — SOURCES.md `openchargemap`: Infrastructure / Network /
// Cyber. EV charging POIs on Vancouver Island. KEYED: free key after signup
// at openchargemap.org — env var OCM_KEY (PLAN.md keys queue); until it
// lands every sync fails cleanly with 'OCM_KEY not configured'.
// Unauthenticated error shape verified live 2026-06-11: HTTP 403, plain-text
// 'You must specify an API key using the key query parameter or x-api-key
// header.' (CORS * even on the 403). Key sent via x-api-key header so it
// never appears in URLs.
// These are SLOW-changing POIs, not live availability (OCM has no real-time
// status) — stored as a snapshot ONLY ('stations:open-charge-map'), no
// readings, no signals. Worst case: 500 POIs (maxresults cap) ≈ 50 KB JSON.
// Gotcha (catalog): boundingbox param is unusual '(lat,lng),(lat,lng)'
// corner pairs. Cadence: slow lane (86400s — station registry).
// License: user-contributed data CC BY 4.0; imported DataProvider records
// require visible per-record provider attribution in any UI.
const META: SourceMeta = {
  slug: 'open-charge-map',
  name: 'Open Charge Map EV Chargers',
  cluster: 'Infrastructure / Network / Cyber',
  cadenceSec: 86400,
  attribution: 'Open Charge Map (openchargemap.org)',
  licenseNote:
    'CC BY 4.0 (user-contributed); imported records carry per-record DataProvider attribution that must be shown',
};

const MAX_POIS = 500;

// Documented POI shape (github.com/openchargemap/ocm-docs Model/); with
// compact=true nested reference entities collapse to IDs, but AddressInfo
// and Connections (with Quantity) remain inline.
interface OcmPoi {
  ID: number;
  AddressInfo?: {
    Title?: string | null;
    Town?: string | null;
    Latitude?: number | null;
    Longitude?: number | null;
  } | null;
  Connections?: Array<{ Quantity?: number | null }> | null;
  NumberOfPoints?: number | null;
  DateLastStatusUpdate?: string | null;
}

interface SnapshotStation {
  id: string;
  label: string;
  lat: number;
  lng: number;
  value: number; // connector/port count
  unit: string; // 'ports'
  at: number;
}

export const sync = internalAction({
  args: {},
  handler: async (ctx) => {
    const key = process.env.OCM_KEY;
    if (!key) {
      await ctx.runMutation(internal.feeds.openChargeMap.fail, {
        error: 'OCM_KEY not configured (see PLAN.md keys queue)',
      });
      return;
    }
    const url =
      'https://api.openchargemap.io/v3/poi?output=json' +
      `&boundingbox=(${VI_BBOX.south},${VI_BBOX.west}),(${VI_BBOX.north},${VI_BBOX.east})` +
      `&maxresults=${MAX_POIS}&compact=true&verbose=false`;
    try {
      const res = await fetchSource(url, { headers: { 'x-api-key': key } });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const pois = (await res.json()) as OcmPoi[];
      const fetchedAt = Date.now();

      const stations: SnapshotStation[] = [];
      for (const poi of pois) {
        const lat = poi.AddressInfo?.Latitude;
        const lng = poi.AddressInfo?.Longitude;
        if (typeof lat !== 'number' || typeof lng !== 'number') continue;
        if (!inBbox(lat, lng)) continue; // re-filter — API bbox edges are loose
        // Port count: sum of per-connection Quantity (unknown quantity = 1
        // connection), falling back to NumberOfPoints; floor 1 — a listed
        // charger has at least one port.
        const fromConnections = (poi.Connections ?? []).reduce(
          (n, c) => n + (typeof c.Quantity === 'number' && c.Quantity > 0 ? c.Quantity : 1),
          0,
        );
        const ports = Math.max(fromConnections, poi.NumberOfPoints ?? 0, 1);
        const updated = poi.DateLastStatusUpdate ? Date.parse(poi.DateLastStatusUpdate) : NaN;
        stations.push({
          id: String(poi.ID),
          label: poi.AddressInfo?.Title?.trim() || `OCM ${poi.ID}`,
          lat,
          lng,
          value: ports,
          unit: 'ports',
          at: Number.isFinite(updated) ? updated : fetchedAt,
        });
        if (stations.length >= MAX_POIS) break;
      }
      await ctx.runMutation(internal.feeds.openChargeMap.ingest, { stations });
    } catch (e) {
      await ctx.runMutation(internal.feeds.openChargeMap.fail, { error: String(e) });
    }
  },
});

export const ingest = internalMutation({
  args: { stations: v.array(v.any()) },
  handler: async (ctx, { stations }) => {
    await writeSnapshot(ctx, `stations:${META.slug}`, JSON.stringify(stations));
    await reportSuccess(ctx, META, stations.length);
  },
});

export const fail = internalMutation({
  args: { error: v.string() },
  handler: async (ctx, { error }) => {
    await reportFailure(ctx, META, error);
  },
});
