import { v } from 'convex/values';
import { internalAction, internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { fetchSource } from '../lib/fetchSource';
import { inBbox, cellOf } from '../lib/geo';
import { upsertMovers, type MoverInput } from '../lib/movers';
import {
  upsertSignals,
  reportSuccess,
  reportFailure,
  type SourceMeta,
  type SignalInput,
} from '../lib/ingest';

// bc-ferries — SOURCES.md: Seas (Marine), community bcferriesapi.ca scrape of
// bcferries.com. BC Ferries publishes no open API and the official Conditions
// Center (cc.bcferries.com) is WAF-blocked server-side, so this is the only
// machine-readable sailing feed. It carries NO coordinates: vessel positions
// here are schedule-derived ESTIMATES — straight-line interpolation between
// terminal berths for sailings flagged 'current', marked estimated:true in
// state. Real AIS positions arrive later via the aisstream worker
// (ARCHITECTURE §6); this polled layer keeps the SEAS picture alive when the
// worker is down. Verified live 2026-06-11: /v2/capacity/ returns
// {routes:[...]} as documented; sailingDuration can be '' (HSBNAN);
// arrivalTime can be 'Variable' (SGI run); nonCapacityRoutes (unused here)
// lack sailingStatus entirely.
// Worst case: 12 capacity routes × ~30 sailings scanned, ≤ ~20 vessels
// underway at once, signals only on disruptions (fair weather = 0).
const META: SourceMeta = {
  slug: 'bc-ferries',
  name: 'BC Ferries (bcferriesapi.ca)',
  cluster: 'Seas (Marine)',
  cadenceSec: 120,
  attribution: 'BC Ferries · bcferriesapi.ca (community)',
  licenseNote:
    'Community scrape of bcferries.com (API code MIT, data unsanctioned) — single-operator use, do not redistribute',
};

const URL = 'https://www.bcferriesapi.ca/v2/capacity/';

// Approximate terminal berth coordinates for the capacity-route network.
// SGI is the multi-stop Southern Gulf Islands run — anchored at Village Bay
// (Mayne Is.) as a representative mid-run point.
const TERMINALS: Record<string, { name: string; lat: number; lng: number }> = {
  TSA: { name: 'Tsawwassen', lat: 49.0063, lng: -123.1322 },
  SWB: { name: 'Swartz Bay', lat: 48.6889, lng: -123.4106 },
  DUK: { name: 'Duke Point', lat: 49.1632, lng: -123.8905 },
  NAN: { name: 'Departure Bay', lat: 49.1934, lng: -123.9554 },
  HSB: { name: 'Horseshoe Bay', lat: 49.3754, lng: -123.2717 },
  LNG: { name: 'Langdale', lat: 49.4339, lng: -123.4721 },
  BOW: { name: 'Snug Cove (Bowen Is.)', lat: 49.3819, lng: -123.3357 },
  FUL: { name: 'Fulford Harbour', lat: 48.7685, lng: -123.45 },
  SGI: { name: 'Southern Gulf Islands', lat: 48.8508, lng: -123.3219 },
};

interface CapacitySailing {
  time: string; // "6:14 am"
  arrivalTime: string; // "7:54 am" | "Variable" | ""
  sailingStatus: string; // "" | "past" | "current" | "future" | disruption text
  fill: number;
  carFill: number;
  oversizeFill: number;
  vesselName: string;
  vesselStatus: string; // free text, "" in fair weather
}

interface CapacityRoute {
  routeCode: string; // "TSASWB"
  fromTerminalCode: string;
  toTerminalCode: string;
  sailingDuration: string; // "1h 35m" | "" (observed empty on HSBNAN)
  sailings: CapacitySailing[];
}

// Normal lifecycle values of sailingStatus — anything else is a disruption
// note (e.g. "Cancelled"), per the upstream scraper's pass-through behaviour.
const LIFECYCLE = new Set(['', 'past', 'current', 'future']);

// "6:14 am" → minutes since Pacific midnight; null if unparseable.
function parseClockMin(t: string): number | null {
  const m = /(\d{1,2}):(\d{2})\s*(am|pm)/i.exec(t);
  if (!m) return null;
  const h = Number(m[1]) % 12;
  return (h + (/pm/i.test(m[3]) ? 12 : 0)) * 60 + Number(m[2]);
}

// "1h 35m" → minutes; null if unparseable (sailingDuration is '' on HSBNAN).
function parseDurationMin(d: string): number | null {
  const h = /(\d+)\s*h/.exec(d);
  const m = /(\d+)\s*m/.exec(d);
  if (!h && !m) return null;
  return Number(h?.[1] ?? 0) * 60 + Number(m?.[1] ?? 0);
}

// Pacific clock without Intl (Convex default runtime — keep it dependency
// free). DST: 2nd Sunday of March → 1st Sunday of November; the one-hour
// slack at the 02:00 changeover is fine for an estimated-position layer.
function pacificClock(now: Date): { minutes: number; date: string } {
  const y = now.getUTCFullYear();
  const nthSundayUtc = (month: number, n: number): number => {
    const firstDow = new Date(Date.UTC(y, month, 1)).getUTCDay();
    const day = 1 + ((7 - firstDow) % 7) + (n - 1) * 7;
    return Date.UTC(y, month, day, 10); // 02:00 PST = 10:00 UTC
  };
  const dst = now.getTime() >= nthSundayUtc(2, 2) && now.getTime() < nthSundayUtc(10, 1);
  const local = new Date(now.getTime() + (dst ? -7 : -8) * 3_600_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    minutes: local.getUTCHours() * 60 + local.getUTCMinutes(),
    date: `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`,
  };
}

// Initial great-circle bearing, degrees clockwise from north.
function bearingDeg(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLng = toRad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export const sync = internalAction({
  args: {},
  handler: async (ctx) => {
    try {
      const res = await fetchSource(URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Verified live 2026-06-11: {routes:[...]}. Tolerate a bare array and
      // the v2-root key too in case the volunteer API shifts.
      const body = (await res.json()) as
        | CapacityRoute[]
        | { routes?: CapacityRoute[]; capacityRoutes?: CapacityRoute[] };
      const routes: CapacityRoute[] = Array.isArray(body)
        ? body
        : (body.routes ?? body.capacityRoutes ?? []);

      const fetchedAt = Date.now();
      const { minutes: nowMin, date } = pacificClock(new Date(fetchedAt));
      const byVessel = new Map<string, MoverInput>();
      const signals: SignalInput[] = [];

      for (const r of routes) {
        const dep = TERMINALS[r.fromTerminalCode];
        const dst = TERMINALS[r.toTerminalCode];
        for (const s of r.sailings ?? []) {
          // (a) movers — vessels on a 'current' sailing, dead-reckoned along
          // the route by elapsed fraction of the scheduled crossing.
          if (dep && dst && s.sailingStatus === 'current') {
            const depMin = parseClockMin(s.time);
            if (depMin === null) continue;
            const arrMin = parseClockMin(s.arrivalTime); // null on 'Variable'
            const durMin =
              (arrMin !== null ? (arrMin - depMin + 1440) % 1440 : null) ||
              parseDurationMin(r.sailingDuration) ||
              90;
            let elapsed = nowMin - depMin;
            if (elapsed < -720) elapsed += 1440; // sailing departed before local midnight
            const frac = Math.min(1, Math.max(0, elapsed / durMin));
            const lat = dep.lat + (dst.lat - dep.lat) * frac;
            const lng = dep.lng + (dst.lng - dep.lng) * frac;
            const extId = s.vesselName
              ? slugify(s.vesselName)
              : `${r.routeCode.toLowerCase()}-${slugify(s.time)}`;
            if (!inBbox(lat, lng) || byVessel.has(extId)) continue;
            byVessel.set(extId, {
              extId,
              label: s.vesselName || r.routeCode,
              tag: r.routeCode,
              cat: 'ferry',
              lat,
              lng,
              heading: bearingDeg(dep, dst),
              state: JSON.stringify({
                route: r.routeCode,
                status: s.sailingStatus,
                destination: dst.name,
                estimated: true, // schedule-derived, not AIS
              }),
              at: fetchedAt,
            });
          }

          // (b) signals — notable disruptions only: a non-lifecycle
          // sailingStatus (e.g. "Cancelled") or cancel/delay text in
          // vesselStatus. Fair weather yields zero signals by design.
          const note = (s.vesselStatus ?? '').trim();
          const irregular = !LIFECYCLE.has((s.sailingStatus ?? '').toLowerCase());
          if (!irregular && !/cancel|delay/i.test(note)) continue;
          const statusText = [irregular ? s.sailingStatus : '', note].filter(Boolean).join(' · ');
          // severity: cancelled or delayed ≥30 min → watch; other hiccups info
          const delayMin = Number(/(\d+)\s*min/i.exec(statusText)?.[1] ?? 0);
          const severity: SignalInput['severity'] =
            /cancel/i.test(statusText) || delayMin >= 30 ? 'watch' : 'info';
          const mid =
            dep && dst
              ? { lat: (dep.lat + dst.lat) / 2, lng: (dep.lng + dst.lng) / 2 }
              : undefined;
          signals.push({
            sourceSlug: META.slug,
            kind: 'vessel-event',
            title: `Ferry ${r.fromTerminalCode}→${r.toTerminalCode} ${s.time}: ${statusText || 'disruption'}`,
            summary: s.vesselName ? `${s.vesselName}: ${statusText}` : statusText,
            severity,
            lat: mid?.lat,
            lng: mid?.lng,
            cell: mid ? cellOf(mid.lat, mid.lng) : undefined,
            observedAt: fetchedAt,
            expiresAt: fetchedAt + 6 * 3_600_000, // sailing-day relevance only
            dedupeKey: `${META.slug}:${date}:${r.routeCode}:${s.time}`,
            confidence: 0.4, // scraped/unofficial (ARCHITECTURE §4)
            provenance: JSON.stringify({ method: 'poll', fetchedAt, url: URL }),
            raw: JSON.stringify({ routeCode: r.routeCode, ...s }).slice(0, 2000),
          });
        }
      }

      await ctx.runMutation(internal.feeds.bcFerries.ingest, {
        movers: [...byVessel.values()],
        signals,
      });
    } catch (e) {
      await ctx.runMutation(internal.feeds.bcFerries.fail, { error: String(e) });
    }
  },
});

export const ingest = internalMutation({
  args: { movers: v.array(v.any()), signals: v.array(v.any()) },
  handler: async (ctx, { movers, signals }) => {
    const moverCount = await upsertMovers(ctx, 'ferry', META.slug, movers as MoverInput[]);
    await upsertSignals(ctx, signals as SignalInput[]);
    await reportSuccess(ctx, META, moverCount + signals.length);
  },
});

export const fail = internalMutation({
  args: { error: v.string() },
  handler: async (ctx, { error }) => {
    await reportFailure(ctx, META, error);
  },
});
