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

// drivebc-open511 — SOURCES.md: Ground (Mobility). Open511 /events, no auth,
// format=json, status=ACTIVE, bbox=VI box (bbox param verified working
// 2026-06-11; preferred over area_id=drivebc.ca/2). Pagination is offset/limit
// — NOTE: live responses carry only previous_url + offset, never next_url
// (diverges from SOURCES.md), so we walk offsets and stop on a short page.
// Worst case 300 records/sync (MAX_RECORDS cap = 3 pages × 100; live check
// 2026-06-11 saw 133 active VI events). Cadence: medium lane (300s).
const META: SourceMeta = {
  slug: 'drivebc-open511',
  name: 'DriveBC Open511 Events',
  cluster: 'Ground (Mobility)',
  cadenceSec: 300,
  attribution:
    'Contains information licensed under the Open Government Licence - British Columbia (DriveBC / Province of British Columbia).',
};

const PAGE = 100;
const MAX_RECORDS = 300; // hard cap per sync — see header comment

// Severity from upstream `severity` (Open511 enum; observed MINOR|MAJOR on
// 2026-06-11, spec also allows MODERATE|UNKNOWN): MAJOR → warning, all else →
// info. Road events are never life-safety-critical on their own.
const severityOf = (sev?: string): 'info' | 'warning' => (sev === 'MAJOR' ? 'warning' : 'info');

interface Open511Road {
  name?: string;
  from?: string;
  to?: string;
  direction?: string;
}
interface Open511Geometry {
  type: string;
  coordinates: unknown;
}
interface Open511Event {
  id: string; // e.g. "drivebc.ca/DBC-77329"
  url?: string;
  headline?: string;
  status?: string;
  created?: string;
  updated?: string;
  description?: string;
  schedule?: {
    intervals?: string[];
    recurring_schedules?: Array<{ start_date?: string; end_date?: string }>;
  };
  event_type?: string; // observed CONSTRUCTION | INCIDENT | SPECIAL_EVENT
  severity?: string;
  geography?: Open511Geometry; // GeoJSON Point or LineString
  roads?: Open511Road[];
}

// Centroid for the signal's lat/lng; full geometry goes to `geojson`.
function centroidOf(g: Open511Geometry): { lat: number; lng: number } | null {
  if (g.type === 'Point') {
    const [lng, lat] = g.coordinates as [number, number];
    return { lat, lng };
  }
  if (g.type === 'LineString') {
    const coords = g.coordinates as [number, number][];
    if (coords.length === 0) return null;
    let lat = 0;
    let lng = 0;
    for (const [x, y] of coords) {
      lng += x;
      lat += y;
    }
    return { lat: lat / coords.length, lng: lng / coords.length };
  }
  return null;
}

// Size discipline: construction-zone LineStrings reach 775 coords / 20KB
// (DBC-92452 at build time) — simplify like bcwsFires does for perimeters.
function simplifyGeometry(g: Open511Geometry): Open511Geometry {
  if (g.type !== 'LineString' || (g.coordinates as unknown[]).length <= 50) return g;
  try {
    const feature = { type: 'Feature', properties: {}, geometry: g } as Parameters<
      typeof simplify
    >[0];
    const out = simplify(feature, { tolerance: 0.001, highQuality: false }) as {
      geometry: Open511Geometry;
    };
    return out.geometry;
  } catch {
    return g;
  }
}

// Schedule times are UTC without zone suffix per the Open511 spec (verified:
// interval "2026-08-03T03:00/…" matches "Aug 2 at 8:00 PM PDT" in the same
// event's description). Open-ended intervals ("2025-05-30T15:12/") → no expiry.
function parseUtc(s?: string): number | undefined {
  if (!s) return undefined;
  const t = Date.parse(/[Zz]|[+-]\d{2}:?\d{2}$/.test(s) ? s : `${s}Z`);
  return Number.isNaN(t) ? undefined : t;
}

function scheduleEnd(schedule?: Open511Event['schedule']): number | undefined {
  let latest: number | undefined;
  for (const iv of schedule?.intervals ?? []) {
    const t = parseUtc(iv.split('/')[1] || undefined);
    if (t !== undefined) latest = Math.max(latest ?? 0, t);
  }
  for (const rs of schedule?.recurring_schedules ?? []) {
    const t = rs.end_date ? parseUtc(`${rs.end_date}T23:59:59`) : undefined;
    if (t !== undefined) latest = Math.max(latest ?? 0, t);
  }
  return latest;
}

function scheduleStart(ev: Open511Event): number | undefined {
  const first = ev.schedule?.intervals?.[0]?.split('/')[0];
  return parseUtc(first) ?? parseUtc(ev.created);
}

export const sync = internalAction({
  args: {},
  handler: async (ctx) => {
    const base =
      'https://api.open511.gov.bc.ca/events?format=json&status=ACTIVE' +
      `&bbox=${VI_BBOX.west},${VI_BBOX.south},${VI_BBOX.east},${VI_BBOX.north}`;
    try {
      const events: Open511Event[] = [];
      for (let offset = 0; offset < MAX_RECORDS; offset += PAGE) {
        const res = await fetchSource(`${base}&limit=${PAGE}&offset=${offset}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { events: Open511Event[] };
        events.push(...data.events);
        if (data.events.length < PAGE) break; // no next_url upstream — short page ends the walk
      }
      const fetchedAt = Date.now();
      const signals: SignalInput[] = [];
      for (const ev of events) {
        if (!ev.geography) continue;
        const c = centroidOf(ev.geography);
        if (!c) continue;
        // bbox param already filters upstream; belt-and-suspenders per §5 rule 4
        if (!inBbox(c.lat, c.lng)) continue;
        const road = ev.roads?.[0]?.name;
        // ACTIVE events keep upstream `updated` months in the past (Salt Spring
        // washout: updated 2025-09-02, still active 2026-06) — so observedAt =
        // poll time, refreshed by the dedupe upsert each sync (bcws-fires
        // pattern): events DriveBC resolves age out of the layer window.
        const rawObj = {
          eventType: ev.event_type,
          roads: (ev.roads ?? [])
            .slice(0, 4)
            .map((r) => ({ name: r.name, from: r.from, to: r.to, direction: r.direction })),
        };
        let raw = JSON.stringify(rawObj);
        if (raw.length > 2048) raw = JSON.stringify({ eventType: ev.event_type });
        signals.push({
          sourceSlug: META.slug,
          kind: 'road-event',
          title: `${ev.event_type ?? ev.headline ?? 'ROAD EVENT'} — ${road ?? 'unnamed road'}`,
          summary: ev.description ? ev.description.slice(0, 280) : undefined,
          severity: severityOf(ev.severity),
          lat: c.lat,
          lng: c.lng,
          cell: cellOf(c.lat, c.lng),
          geojson: JSON.stringify(simplifyGeometry(ev.geography)),
          startsAt: scheduleStart(ev),
          observedAt: fetchedAt,
          expiresAt: scheduleEnd(ev.schedule),
          dedupeKey: `drivebc:${ev.id}`,
          confidence: 1.0, // authoritative agency (MOTI / DriveBC)
          provenance: JSON.stringify({
            method: 'poll',
            fetchedAt,
            upstreamId: ev.id,
            url: ev.url,
          }),
          raw,
        });
      }
      await ctx.runMutation(internal.feeds.drivebcEvents.ingest, { signals });
    } catch (e) {
      await ctx.runMutation(internal.feeds.drivebcEvents.fail, { error: String(e) });
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
