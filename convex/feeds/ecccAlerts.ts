import { v } from 'convex/values';
import { internalAction, internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { simplify } from '@turf/turf';
import { fetchSource } from '../lib/fetchSource';
import { VI_BBOX } from '../lib/geo';
import { reportSuccess, reportFailure, type SourceMeta } from '../lib/ingest';

// eccc-weather-alerts — SOURCES.md: Weather & Atmosphere. OGC API Features
// items endpoint, no auth, VI bbox passed upstream (server-side VI filter).
// Writes to the ALERTS table (capId upserts), not signals. Worst case 100
// records/sync (limit=100; ~37 alerts were active Canada-wide at verify time,
// so the VI subset is typically 0-10). numberMatched:0 in fair weather is
// normal and counts as success. Cadence: fast lane (113s).
const META: SourceMeta = {
  slug: 'eccc-weather-alerts',
  name: 'ECCC Weather Alerts',
  cluster: 'Weather & Atmosphere',
  cadenceSec: 113,
  attribution: 'Data Source: Environment and Climate Change Canada',
};

const URL =
  'https://api.weather.gc.ca/collections/weather-alerts/items' +
  `?bbox=${VI_BBOX.west},${VI_BBOX.south},${VI_BBOX.east},${VI_BBOX.north}` +
  '&f=json&limit=100';

type Severity = 'info' | 'watch' | 'warning' | 'critical';

// Severity mapping (SOURCES.md gotcha: this feed is NOT CAP — there is no
// upstream severity field). Derived from properties.alert_type plus
// properties.risk_colour_en: ECCC's own hierarchy is warning > watch >
// statement/advisory, and risk_colour_en "red" flags the highest-impact
// warnings, so warning+red escalates to critical. Statements, advisories and
// anything unrecognized stay ambient at info.
function severityOf(alertType: string | undefined, riskColour: string | undefined): Severity {
  const t = (alertType ?? '').toLowerCase();
  if (t === 'warning') return (riskColour ?? '').toLowerCase() === 'red' ? 'critical' : 'warning';
  if (t === 'watch') return 'watch';
  return 'info'; // statement, advisory, ended, unknown
}

interface Geometry {
  type: string;
  coordinates: unknown;
}

interface AlertFeature {
  id: string;
  geometry: Geometry | null;
  properties: {
    id?: string;
    alert_type?: string;
    alert_name_en?: string;
    alert_text_en?: string;
    publication_datetime?: string;
    expiration_datetime?: string;
    validity_datetime?: string;
    risk_colour_en?: string;
    confidence_en?: string;
    feature_name_en?: string;
  };
}

interface AlertInput {
  sourceSlug: string;
  capId: string;
  headline: string;
  description?: string;
  severity: Severity;
  urgency?: string;
  certainty?: string;
  area?: string;
  effective: number;
  expires?: number;
  status: 'active' | 'expired' | 'cancelled';
}

function vertexCount(geom: Geometry): number {
  let n = 0;
  const walk = (c: unknown): void => {
    if (!Array.isArray(c)) return;
    if (typeof c[0] === 'number') {
      n++;
      return;
    }
    for (const child of c) walk(child);
  };
  walk(geom.coordinates);
  return n;
}

// Alert polygons seen live are ~25 vertices; simplify only the rare huge ones
// (size discipline, ARCHITECTURE §5.5). ~0.005° tolerance ≈ 500 m here.
function areaOf(geom: Geometry | null): string | undefined {
  if (!geom || (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon')) return undefined;
  let g = geom;
  if (vertexCount(geom) > 300) {
    try {
      g = simplify(geom as never, { tolerance: 0.005, highQuality: false }) as Geometry;
    } catch {
      g = geom; // unsimplifiable geometry: store as-is rather than drop the alert
    }
  }
  return JSON.stringify(g);
}

function parseMs(iso: string | undefined): number | undefined {
  if (!iso) return undefined;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? undefined : ms;
}

export const sync = internalAction({
  args: {},
  handler: async (ctx) => {
    try {
      const res = await fetchSource(URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { features: AlertFeature[] };
      const alerts: AlertInput[] = data.features
        .filter((f) => f.id || f.properties.id)
        .map((f) => {
          const p = f.properties;
          const name = p.alert_name_en ?? p.alert_type ?? 'weather alert';
          const headline = `${name.charAt(0).toUpperCase()}${name.slice(1)}${
            p.feature_name_en ? `: ${p.feature_name_en}` : ''
          }`;
          return {
            sourceSlug: META.slug,
            capId: f.id || (p.id as string),
            headline,
            description: p.alert_text_en?.slice(0, 2000),
            severity: severityOf(p.alert_type, p.risk_colour_en),
            certainty: p.confidence_en, // upstream confidence_en, e.g. "High"
            area: areaOf(f.geometry),
            effective:
              parseMs(p.publication_datetime) ?? parseMs(p.validity_datetime) ?? Date.now(),
            expires: parseMs(p.expiration_datetime),
            status: 'active' as const,
          };
        });
      await ctx.runMutation(internal.feeds.ecccAlerts.ingest, { alerts });
    } catch (e) {
      await ctx.runMutation(internal.feeds.ecccAlerts.fail, { error: String(e) });
    }
  },
});

export const ingest = internalMutation({
  args: { alerts: v.array(v.any()) },
  handler: async (ctx, { alerts }) => {
    const inputs = alerts as AlertInput[];
    let inserted = 0;
    let updated = 0;
    for (const a of inputs) {
      const existing = await ctx.db
        .query('alerts')
        .withIndex('by_cap', (q) => q.eq('capId', a.capId))
        .unique();
      if (existing) {
        await ctx.db.patch(existing._id, {
          headline: a.headline,
          description: a.description,
          severity: a.severity,
          certainty: a.certainty,
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
    // Sweep: our active alerts that vanished from the feed are over — flip to
    // expired (past their expiry) or cancelled (withdrawn early). Bounded: VI
    // rarely has more than a handful of concurrent alerts.
    const live = new Set(inputs.map((a) => a.capId));
    const open = await ctx.db
      .query('alerts')
      .withIndex('by_status', (q) => q.eq('status', 'active'))
      .collect();
    const now = Date.now();
    for (const row of open) {
      if (row.sourceSlug !== META.slug || live.has(row.capId)) continue;
      await ctx.db.patch(row._id, {
        status: row.expires && row.expires <= now ? 'expired' : 'cancelled',
      });
    }
    await reportSuccess(ctx, META, inputs.length);
    return { inserted, updated };
  },
});

export const fail = internalMutation({
  args: { error: v.string() },
  handler: async (ctx, { error }) => {
    await reportFailure(ctx, META, error);
  },
});
