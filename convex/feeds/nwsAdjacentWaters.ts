import { v } from 'convex/values';
import { internalAction, internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { fetchSource } from '../lib/fetchSource';
import { reportSuccess, reportFailure, type SourceMeta } from '../lib/ingest';

// nws-adjacent-waters — SOURCES.md: NWS Alerts for adjacent US waters. One
// cached CAP-over-GeoJSON call for the four PZZ13x zones that border VI waters
// (PZZ130/131/132/133, Juan de Fuca + northern inland waters). Writes to the
// ALERTS table (capId upserts), not signals. geometry is null on zone-based
// marine alerts (catalog gotcha) — area stays unset unless upstream sends one.
// Empty features[] is the norm in fair weather and counts as success. Worst
// case ~10 alerts/sync (4 small zones). fetchSource already sends the
// descriptive User-Agent NWS requires. Cadence: medium lane (300s per spec;
// upstream edge cache is max-age=5 so every poll is fresh).
const META: SourceMeta = {
  slug: 'nws-adjacent-waters',
  name: 'NWS Adjacent US Waters Alerts',
  cluster: 'Seas (Marine)',
  cadenceSec: 300,
  attribution: 'NOAA / National Weather Service',
};

const URL = 'https://api.weather.gov/alerts/active?zone=PZZ130,PZZ131,PZZ132,PZZ133';

type Severity = 'info' | 'watch' | 'warning' | 'critical';

// CAP severity → ours (upstream properties.severity, verified live: a Small
// Craft Advisory carries Minor): Extreme=critical, Severe=warning,
// Moderate=watch, Minor/Unknown/absent=info.
function severityOf(cap: string | undefined): Severity {
  switch ((cap ?? '').toLowerCase()) {
    case 'extreme':
      return 'critical';
    case 'severe':
      return 'warning';
    case 'moderate':
      return 'watch';
    default:
      return 'info'; // Minor, Unknown, absent
  }
}

interface AlertFeature {
  id: string;
  geometry: { type: string; coordinates: unknown } | null;
  properties: {
    id?: string;
    event?: string;
    headline?: string;
    areaDesc?: string;
    severity?: string;
    certainty?: string;
    urgency?: string;
    sent?: string;
    effective?: string;
    onset?: string;
    expires?: string;
    ends?: string;
    description?: string;
    senderName?: string;
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

function parseMs(iso: string | undefined): number | undefined {
  if (!iso) return undefined;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? undefined : ms;
}

export const sync = internalAction({
  args: {},
  handler: async (ctx) => {
    try {
      const res = await fetchSource(URL, { headers: { Accept: 'application/geo+json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { features: AlertFeature[] };
      const alerts: AlertInput[] = data.features
        .filter((f) => f.properties.id || f.id)
        .map((f) => {
          const p = f.properties;
          return {
            sourceSlug: META.slug,
            capId: p.id ?? f.id,
            headline:
              p.headline ?? `${p.event ?? 'Marine alert'}${p.areaDesc ? ` — ${p.areaDesc}` : ''}`,
            description: p.description?.slice(0, 2000),
            severity: severityOf(p.severity),
            urgency: p.urgency,
            certainty: p.certainty,
            // geometry is null for zone-based marine alerts; keep when present
            area: f.geometry ? JSON.stringify(f.geometry) : undefined,
            effective: parseMs(p.effective) ?? parseMs(p.sent) ?? Date.now(),
            // ends is the hazard end; expires is just message expiry (gotcha 2)
            expires: parseMs(p.ends) ?? parseMs(p.expires),
            status: 'active' as const,
          };
        });
      await ctx.runMutation(internal.feeds.nwsAdjacentWaters.ingest, { alerts });
    } catch (e) {
      await ctx.runMutation(internal.feeds.nwsAdjacentWaters.fail, { error: String(e) });
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
          urgency: a.urgency,
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
    // Sweep: our active alerts gone from /alerts/active are over — expired if
    // past their end time, cancelled (replaced/withdrawn) otherwise. Bounded:
    // four small marine zones rarely carry more than a handful of alerts.
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
