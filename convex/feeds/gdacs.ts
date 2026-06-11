import { v } from 'convex/values';
import { internalAction, internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { fetchSource } from '../lib/fetchSource';
import { cellOf } from '../lib/geo';
import { upsertSignals, reportSuccess, reportFailure, type SourceMeta, type SignalInput } from '../lib/ingest';

// gdacs — SOURCES.md: World Mode (Global). GDACS multi-hazard disaster alerts
// (UN OCHA / European Commission), keyless GeoJSON. WORLD page signals
// (Phase 5) — kind 'world-event', NO map layer, and the VI bbox filter is
// deliberately skipped: world-event signals are exempt by definition
// (ARCHITECTURE §4 SignalKind note).
//
// Shape drift vs the catalog (re-verified live 2026-06-11): geteventlist/MAP
// is NOT one Point per event — it returns mixed geometries (Point /
// LineString / Polygon: centroids, affected-area circles, cyclone track lines
// and cones) with the SAME eventtype+eventid repeated across features (171
// features = 33 unique events at verification). properties.Class
// 'Point_Centroid' is the one-per-event discriminator; a per-event dedupe map
// backstops it in case Class labels drift.
//
// Severity by GDACS alert level (per spec): Green=info, Orange=watch,
// Red=warning; unknown levels conservatively info. eventid is only unique
// within an eventtype (FL/EQ/TC/VO/DR/WF), so the dedupe id is
// '<eventtype>:<eventid>'. Timestamps carry no zone suffix and are UTC.
// startsAt = fromdate; observedAt = datemodified (last upstream update);
// expiresAt = observedAt + 7d. Cap 50, highest alert level first then most
// recently updated. Worst case 50 signals/sync. Cadence: slow lane (1800s).
const META: SourceMeta = {
  slug: 'gdacs',
  name: 'GDACS global disaster alerts',
  cluster: 'World Mode (Global)',
  cadenceSec: 1800,
  attribution: 'GDACS (UN OCHA / European Commission)',
};

const URL = 'https://www.gdacs.org/gdacsapi/api/events/geteventlist/MAP';
const WEEK_MS = 7 * 24 * 3600 * 1000;
const CAP = 50;

const SEVERITY: Record<string, SignalInput['severity']> = {
  Green: 'info',
  Orange: 'watch',
  Red: 'warning',
};
const SEVERITY_RANK: Record<SignalInput['severity'], number> = {
  info: 0,
  watch: 1,
  warning: 2,
  critical: 3,
};

interface GdacsFeature {
  geometry?: { type?: string; coordinates?: unknown };
  properties?: {
    Class?: string;
    eventtype?: string;
    eventid?: number;
    episodeid?: number;
    eventname?: string;
    name?: string;
    description?: string;
    alertlevel?: string;
    alertscore?: number;
    country?: string;
    iso3?: string;
    fromdate?: string;
    todate?: string;
    datemodified?: string;
    iscurrent?: string;
    severitydata?: { severity?: number; severitytext?: string; severityunit?: string };
    url?: { report?: string; details?: string; geometry?: string };
  };
}

// GDACS dates are UTC without a zone suffix ('2026-06-10T06:04:29').
function parseGdacsUtc(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const t = Date.parse(s.endsWith('Z') ? s : s + 'Z');
  return Number.isFinite(t) ? t : undefined;
}

export const sync = internalAction({
  args: {},
  handler: async (ctx) => {
    try {
      const res = await fetchSource(URL, { timeoutMs: 30_000 });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { features?: GdacsFeature[] };
      const fetchedAt = Date.now();

      // One centroid Point per event; the seen-set backstops the Class filter.
      const seen = new Set<string>();
      const signals: SignalInput[] = [];
      for (const f of data.features ?? []) {
        const p = f.properties ?? {};
        if (f.geometry?.type !== 'Point') continue;
        if (p.Class !== undefined && p.Class !== 'Point_Centroid') continue;
        if (p.eventid === undefined) continue;
        const upstreamId = `${p.eventtype ?? 'XX'}:${p.eventid}`;
        if (seen.has(upstreamId)) continue;
        seen.add(upstreamId);

        const coords = Array.isArray(f.geometry?.coordinates) ? f.geometry.coordinates : [];
        const lng = typeof coords[0] === 'number' ? coords[0] : undefined;
        const lat = typeof coords[1] === 'number' ? coords[1] : undefined;
        // World source: VI bbox filter deliberately skipped (world-event kind).
        const observedAt =
          parseGdacsUtc(p.datemodified) ?? parseGdacsUtc(p.fromdate) ?? fetchedAt;
        const severityText = p.severitydata?.severitytext?.trim();
        signals.push({
          sourceSlug: META.slug,
          kind: 'world-event',
          title: (p.name || p.description || `${p.eventtype ?? 'Disaster'} event ${p.eventid}`).slice(0, 140),
          summary: [
            p.alertlevel ? `${p.alertlevel} alert` : null,
            p.country || null,
            severityText || null,
          ]
            .filter(Boolean)
            .join(' · ')
            .slice(0, 300) || undefined,
          severity: SEVERITY[p.alertlevel ?? ''] ?? 'info',
          lat,
          lng,
          cell: lat !== undefined && lng !== undefined ? cellOf(lat, lng) : undefined,
          startsAt: parseGdacsUtc(p.fromdate),
          observedAt,
          expiresAt: observedAt + WEEK_MS,
          dedupeKey: `gdacs:${upstreamId}`,
          confidence: 1.0, // agency feed (UN OCHA / EC)
          provenance: JSON.stringify({
            method: 'poll',
            fetchedAt,
            upstreamId,
            url: p.url?.report ?? URL,
          }),
          raw: JSON.stringify({
            eventtype: p.eventtype,
            eventid: p.eventid,
            episodeid: p.episodeid,
            alertlevel: p.alertlevel,
            alertscore: p.alertscore,
            country: p.country,
            iso3: p.iso3,
            fromdate: p.fromdate,
            todate: p.todate,
            iscurrent: p.iscurrent,
            severitydata: p.severitydata,
          }).slice(0, 2000),
        });
      }

      // Cap 50: highest alert level first, then most recently updated.
      signals.sort(
        (a, b) =>
          SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.observedAt - a.observedAt,
      );
      await ctx.runMutation(internal.feeds.gdacs.ingest, { signals: signals.slice(0, CAP) });
    } catch (e) {
      await ctx.runMutation(internal.feeds.gdacs.fail, { error: String(e) });
    }
  },
});

export const ingest = internalMutation({
  args: { signals: v.array(v.any()) },
  handler: async (ctx, { signals }) => {
    const { inserted, updated } = await upsertSignals(ctx, signals as SignalInput[]);
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
