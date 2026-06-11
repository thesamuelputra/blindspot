import { v } from 'convex/values';
import { simplify } from '@turf/turf';
import type { Feature, MultiPolygon, Polygon } from 'geojson';
import { internalAction, internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { fetchSource } from '../lib/fetchSource';
import { reportSuccess, reportFailure, type SourceMeta } from '../lib/ingest';
import { parseXml, asArray } from '../lib/xml';

// naad-pelmorex — SOURCES.md: Pulse (News / Civic / Events). National Public
// Alerting System / Alert Ready CAP-CP archive over HTTPS (capcp1/capcp2
// date directories). We poll the archive only — the raw TCP stream on
// streaming{1,2}:8080 is deliberately a worker concern, not handled here.
// Writes to the ALERTS table (not signals), upserting by capId.
// Worst case per sync: 1 directory listing (~150 filenames/day Canada-wide,
// 2 listings briefly after UTC midnight) + ≤25 alert XML fetches in the
// 15-min lookback window, yielding a handful of VI alert rows. Typical poll
// in fair weather: 0 new files → success with count 0. Cadence: fast (107s).
const META: SourceMeta = {
  slug: 'naad-pelmorex',
  name: 'Canada NAAD / Alert Ready (Pelmorex)',
  cluster: 'Pulse (News / Civic / Events)',
  cadenceSec: 107,
  attribution: 'National Public Alerting System / Alert Ready (Pelmorex NAAD); issuing agency per alert',
};

const HOSTS = [
  'https://capcp1.naad-adna.pelmorex.com',
  'https://capcp2.naad-adna.pelmorex.com', // mirror — failover only
];

// Look back far enough to survive a few missed polls; capId upserts keep
// re-fetches of the same file idempotent.
const LOOKBACK_MS = 15 * 60_000;
const MAX_FILES_PER_SYNC = 25;

// SGC census-division codes for the seven Vancouver Island regional
// districts, verified against StatCan census geography (SOURCES.md
// naad-pelmorex entry): Capital 5917, Cowichan Valley 5919, Nanaimo 5921,
// Alberni-Clayoquot 5923, Strathcona 5924, Comox Valley 5926,
// Mount Waddington 5943. CAP-CP geocode values are 2/4/7-digit SGC codes;
// 7-digit census subdivisions carry their CD as the first 4 digits, and a
// bare '59' means a BC province-wide alert — accept all three forms.
const VI_SGC_CDS = ['5917', '5919', '5921', '5923', '5924', '5926', '5943'];

function matchesVi(sgcValues: string[]): boolean {
  return sgcValues.some(
    (code) =>
      code === '59' ||
      VI_SGC_CDS.some((cd) => code === cd || (code.length === 7 && code.startsWith(cd))),
  );
}

// CAP <info><severity> + <urgency> → console severity:
// severity=Extreme OR urgency=Immediate → critical; severity=Severe →
// warning; severity=Moderate → watch; else (Minor/Unknown) → info.
const SEVERITY = (
  capSeverity: string,
  capUrgency: string,
): 'info' | 'watch' | 'warning' | 'critical' =>
  capSeverity === 'Extreme' || capUrgency === 'Immediate'
    ? 'critical'
    : capSeverity === 'Severe'
      ? 'warning'
      : capSeverity === 'Moderate'
        ? 'watch'
        : 'info';

// Minimal CAP 1.2 shapes as parsed by lib/xml (fast-xml-parser collapses
// single children; numeric-looking text becomes number — always String()).
interface CapGeocode {
  valueName?: unknown;
  value?: unknown;
}
interface CapArea {
  areaDesc?: unknown;
  polygon?: unknown;
  geocode?: CapGeocode | CapGeocode[];
}
interface CapInfo {
  language?: unknown;
  headline?: unknown;
  description?: unknown;
  severity?: unknown;
  urgency?: unknown;
  certainty?: unknown;
  effective?: unknown;
  expires?: unknown;
  area?: CapArea | CapArea[];
}
interface CapAlert {
  identifier?: unknown;
  status?: unknown;
  msgType?: unknown;
  sent?: unknown;
  references?: unknown;
  info?: CapInfo | CapInfo[];
}

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
  status: 'active' | 'expired' | 'cancelled';
}

async function fetchNaad(path: string): Promise<string> {
  let lastError: unknown;
  for (const host of HOSTS) {
    try {
      const res = await fetchSource(`${host}${path}`);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${host}${path}`);
      return await res.text();
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

// Archive filenames are "{sent}I{identifier}" with ':' and '-' replaced by
// '_', e.g. 2026_06_11T14_09_26_00_00Iurn_oid_….xml — the leading 19 chars
// are the sent timestamp (NAAD emits a -00:00 offset, i.e. UTC).
function sentMsFromFilename(file: string): number | null {
  const m = /^(\d{4})_(\d{2})_(\d{2})T(\d{2})_(\d{2})_(\d{2})/.exec(file);
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}

function parseCapTime(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  const t = Date.parse(String(value));
  return Number.isFinite(t) ? t : null;
}

function geocodeValues(area: CapArea): string[] {
  return asArray(area.geocode)
    .filter((g) => String(g.valueName ?? '').startsWith('profile:CAP-CP:Location'))
    .map((g) => String(g.value ?? ''));
}

// CAP polygons are 'lat,lon lat,lon …' strings → GeoJSON [lng, lat] ring.
function capPolygonToRing(polygon: string): [number, number][] | null {
  const points = polygon
    .trim()
    .split(/\s+/)
    .map((pair) => {
      const [lat, lng] = pair.split(',').map(Number);
      return [lng, lat] as [number, number];
    });
  if (points.length < 3 || points.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y)))
    return null;
  const [fx, fy] = points[0];
  const [lx, ly] = points[points.length - 1];
  if (fx !== lx || fy !== ly) points.push([fx, fy]); // close the ring
  return points;
}

// VI-matching areas → stringified GeoJSON Feature; ECCC polygons can be
// verbose, so simplify when large (ARCHITECTURE §5.5 size discipline).
function areasToGeojson(areas: CapArea[]): string | undefined {
  const rings: [number, number][][] = [];
  for (const area of areas) {
    for (const poly of asArray(area.polygon)) {
      const ring = capPolygonToRing(String(poly));
      if (ring) rings.push(ring);
    }
  }
  if (rings.length === 0) return undefined;
  const geometry: Polygon | MultiPolygon =
    rings.length === 1
      ? { type: 'Polygon', coordinates: [rings[0]] }
      : { type: 'MultiPolygon', coordinates: rings.map((r) => [r]) };
  let feature: Feature<Polygon | MultiPolygon> = {
    type: 'Feature',
    properties: {
      areaDesc: areas
        .map((a) => String(a.areaDesc ?? ''))
        .filter(Boolean)
        .join('; '),
    },
    geometry,
  };
  const vertices = rings.reduce((n, r) => n + r.length, 0);
  if (vertices > 150) {
    feature = simplify(feature, { tolerance: 0.01, highQuality: false });
  }
  return JSON.stringify(feature);
}

// <references> is space-separated 'sender,identifier,sent' triples.
function referencedIds(references: unknown): string[] {
  return String(references ?? '')
    .trim()
    .split(/\s+/)
    .map((triple) => triple.split(',')[1])
    .filter(Boolean);
}

export const sync = internalAction({
  args: {},
  handler: async (ctx) => {
    try {
      const now = Date.now();
      // Directories are named by UTC date; shortly after UTC midnight the
      // lookback window straddles yesterday's directory too.
      const days = [new Date(now).toISOString().slice(0, 10)];
      if (now % 86_400_000 < LOOKBACK_MS) {
        days.push(new Date(now - 86_400_000).toISOString().slice(0, 10));
      }

      const candidates: { day: string; file: string; sentMs: number }[] = [];
      for (const day of days) {
        const html = await fetchNaad(`/${day}/`);
        for (const m of html.matchAll(/href="([^"]+\.xml)"/g)) {
          const file = m[1];
          // Skip EEW test messages (nrcan_eew_test…) and any heartbeat files
          // by name; the status!=='Actual' check below is the authoritative
          // filter for anything that slips through.
          if (/test|heartbeat|naads/i.test(file)) continue;
          const sentMs = sentMsFromFilename(file);
          if (sentMs === null || sentMs < now - LOOKBACK_MS) continue;
          candidates.push({ day, file, sentMs });
        }
      }
      candidates.sort((a, b) => a.sentMs - b.sentMs);

      const alerts: AlertInput[] = [];
      const expiredRefs: string[] = []; // superseded by an Update
      const cancelledRefs: string[] = []; // retracted by a Cancel
      for (const { day, file } of candidates.slice(-MAX_FILES_PER_SYNC)) {
        let alert: CapAlert | undefined;
        try {
          const xml = await fetchNaad(`/${day}/${file}`);
          alert = (parseXml(xml) as { alert?: CapAlert }).alert;
        } catch {
          continue; // one malformed/unfetchable file must not kill the sync
        }
        if (!alert?.identifier) continue;
        // Heartbeats are status=System, EEW tests status=Test — only real
        // public alerts (status=Actual) get ingested.
        if (String(alert.status) !== 'Actual') continue;

        const msgType = String(alert.msgType ?? 'Alert');
        if (msgType === 'Cancel') {
          cancelledRefs.push(...referencedIds(alert.references));
          continue; // the Cancel itself is not a new alert row
        }
        if (msgType !== 'Alert' && msgType !== 'Update') continue; // Ack/Error
        if (msgType === 'Update') expiredRefs.push(...referencedIds(alert.references));

        // Pick the first English info block with a VI-matching area; CAP-CP
        // duplicates every info in fr-CA, and missing language defaults to
        // English per the CAP spec.
        const english = asArray(alert.info).filter((info) =>
          String(info.language ?? 'en-CA')
            .toLowerCase()
            .startsWith('en'),
        );
        let chosen: CapInfo | undefined;
        let viAreas: CapArea[] = [];
        for (const info of english) {
          const areas = asArray(info.area).filter((a) => matchesVi(geocodeValues(a)));
          if (areas.length > 0) {
            chosen = info;
            viAreas = areas;
            break;
          }
        }
        if (!chosen) continue; // not a Vancouver Island alert

        const effective = parseCapTime(chosen.effective) ?? parseCapTime(alert.sent) ?? now;
        const expires = parseCapTime(chosen.expires) ?? undefined;
        const description = chosen.description
          ? String(chosen.description).slice(0, 2000)
          : undefined;
        alerts.push({
          sourceSlug: META.slug,
          capId: String(alert.identifier),
          headline: String(chosen.headline ?? 'Public alert'),
          description,
          severity: SEVERITY(String(chosen.severity ?? ''), String(chosen.urgency ?? '')),
          urgency: chosen.urgency !== undefined ? String(chosen.urgency) : undefined,
          certainty: chosen.certainty !== undefined ? String(chosen.certainty) : undefined,
          area: areasToGeojson(viAreas),
          effective,
          expires,
          status: expires !== undefined && expires < now ? 'expired' : 'active',
        });
      }

      await ctx.runMutation(internal.feeds.naadPelmorex.ingest, {
        alerts,
        expiredRefs,
        cancelledRefs,
      });
    } catch (e) {
      await ctx.runMutation(internal.feeds.naadPelmorex.fail, { error: String(e) });
    }
  },
});

export const ingest = internalMutation({
  args: {
    alerts: v.array(v.any()),
    expiredRefs: v.array(v.string()),
    cancelledRefs: v.array(v.string()),
  },
  handler: async (ctx, { alerts, expiredRefs, cancelledRefs }) => {
    let inserted = 0;
    let updated = 0;
    for (const a of alerts as AlertInput[]) {
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
          // a re-fetched original must not resurrect a cancelled alert
          status: existing.status === 'cancelled' ? 'cancelled' : a.status,
        });
        updated++;
      } else {
        await ctx.db.insert('alerts', a);
        inserted++;
      }
    }
    // CAP supersession: Updates expire their referenced alerts, Cancels
    // retract them. Refs outside VI simply won't be in the table.
    for (const [refs, status] of [
      [expiredRefs, 'expired'],
      [cancelledRefs, 'cancelled'],
    ] as const) {
      for (const capId of refs) {
        const row = await ctx.db
          .query('alerts')
          .withIndex('by_cap', (q) => q.eq('capId', capId))
          .unique();
        if (row && row.status !== status && !(status === 'expired' && row.status === 'cancelled')) {
          await ctx.db.patch(row._id, { status });
        }
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
