import { v } from 'convex/values';
import { cellToBoundary, cellToLatLng } from 'h3-js';
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

// gpsjam — SOURCES.md: RF / Signals. Daily gzip CSV of H3 res-4 cells with
// good/bad GPS-accuracy aircraft counts (gpsjam.org/data/YYYY-MM-DD-h3_4.csv).
// 24-hour aggregate published with ~1-day lag — situational awareness, not
// alerting; the lag is stated in every signal summary. ~340 res-4 cells cover
// the wide VI box; typically <20 carry any interference, worst case 340/sync.
// Cadence: slow lane (21600s; the file changes once a day, cache max-age 3600).
// h3-js is resolved via deck.gl's pinned transitive dep (4.4.0, pure JS).
const META: SourceMeta = {
  slug: 'gpsjam',
  name: 'GPSJAM daily GPS interference',
  cluster: 'RF / Signals',
  cadenceSec: 21600,
  attribution: 'GPSJAM / John Wiseman · data: ADS-B Exchange',
  licenseNote: 'no published license — courtesy attribution per site convention',
};

// Wide box around VI for interference awareness (spec: lat 46–53, lng −130…−120)
// — deliberately wider than VI_BBOX so approaches/offshore jamming shows.
const BOX = { south: 46, north: 53, west: -130, east: -120 };

// Site FAQ formula: bad% = 100*(bad−1)/(good+bad) — a single bad aircraft is
// discounted. Map FAQ thresholds: yellow 2–10%, red >10%. Severity mapping
// (documented): low (<2%) → info, med (2–10%) → watch, high (>10%) → warning.
function levelOf(pct: number): { level: string; severity: SignalInput['severity'] } {
  if (pct > 10) return { level: 'high', severity: 'warning' };
  if (pct >= 2) return { level: 'med', severity: 'watch' };
  return { level: 'low', severity: 'info' };
}

function utcDay(daysBack: number): { str: string; ms: number } {
  const d = new Date(Date.now() - daysBack * 86_400_000);
  const ms = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return { str: new Date(ms).toISOString().slice(0, 10), ms };
}

const round5 = (n: number) => Math.round(n * 1e5) / 1e5;

export const sync = internalAction({
  args: {},
  handler: async (ctx) => {
    try {
      // Yesterday's file usually exists (~1-day lag); right after 00:00 UTC it
      // may not be generated yet, so fall back one more day.
      let csv: string | undefined;
      let day: { str: string; ms: number } | undefined;
      for (const daysBack of [1, 2]) {
        const candidate = utcDay(daysBack);
        const res = await fetchSource(`https://gpsjam.org/data/${candidate.str}-h3_4.csv`, {
          headers: { 'Accept-Encoding': 'gzip' },
        });
        if (res.ok) {
          csv = await res.text();
          day = candidate;
          break;
        }
        if (res.status !== 404) throw new Error(`HTTP ${res.status}`);
      }
      if (!csv || !day) throw new Error('no daily file found (1–2 days back)');

      const fetchedAt = Date.now();
      const signals: SignalInput[] = [];
      // header: hex,count_good_aircraft,count_bad_aircraft (~45,900 rows global)
      for (const line of csv.trim().split('\n').slice(1)) {
        const [hex, goodStr, badStr] = line.split(',');
        if (!hex || !badStr) continue;
        const good = Number(goodStr);
        const bad = Number(badStr);
        const pct = (100 * (bad - 1)) / (good + bad);
        if (!Number.isFinite(pct) || pct <= 0) continue; // no interference → no signal
        const [lat, lng] = cellToLatLng(hex);
        if (lat < BOX.south || lat > BOX.north || lng < BOX.west || lng > BOX.east) continue;
        const { level, severity } = levelOf(pct);
        // cellToBoundary(hex, true) → closed [lng,lat] GeoJSON loop
        const ring = cellToBoundary(hex, true).map(([x, y]) => [round5(x), round5(y)]);
        signals.push({
          sourceSlug: META.slug,
          kind: 'anomaly',
          title: `GPS interference ${level}`,
          summary:
            `${pct.toFixed(1)}% of aircraft reported degraded GPS accuracy in this cell ` +
            `(${bad} of ${good + bad}) on ${day.str}. Daily aggregate published about a day behind.`,
          severity,
          lat,
          lng,
          cell: cellOf(lat, lng),
          geojson: JSON.stringify({ type: 'Polygon', coordinates: [ring] }),
          observedAt: day.ms,
          expiresAt: day.ms + 48 * 3_600_000,
          // One signal per H3 cell, patched daily — per-day keys would stack
          // overlapping 60-alpha fills during the 48h expiry window.
          dedupeKey: `${META.slug}:${hex}`,
          confidence: 0.6, // modeled: jamming inferred from ADS-B nav-accuracy proxy
          provenance: JSON.stringify({
            method: 'poll',
            fetchedAt,
            upstreamId: hex,
            url: `https://gpsjam.org/data/${day.str}-h3_4.csv`,
            dataDate: day.str,
          }),
          raw: JSON.stringify({ good, bad, badPct: Math.round(pct * 10) / 10 }),
        });
      }
      await ctx.runMutation(internal.feeds.gpsjam.ingest, { signals });
    } catch (e) {
      await ctx.runMutation(internal.feeds.gpsjam.fail, { error: String(e) });
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
