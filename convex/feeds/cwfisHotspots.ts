import { v } from 'convex/values';
import { internalAction, internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { fetchSource } from '../lib/fetchSource';
import { VI_BBOX, inBbox, cellOf } from '../lib/geo';
import { upsertSignals, reportSuccess, reportFailure, type SourceMeta } from '../lib/ingest';

// cwfis — SOURCES.md: Wildfire. CWFIS datamart daily hotspots CSV at
// /downloads/hotspots/yyyymmdd.csv (UTC date; the old static hotspots.csv
// 404s). File is continental North America (~300 rows fair season, tens of
// thousands at peak) — parsed line-by-line and bbox-filtered server-side.
// Worst case ~500 VI records/sync (capped at 1000 as a hard guard; today's
// file had 267 continental rows, 0 on VI). Empty in winter/fair season is a
// SUCCESS with count 0. No auth. Cadence: medium lane (1800s).
const META: SourceMeta = {
  slug: 'cwfis',
  name: 'CWFIS Hotspots (NRCan)',
  cluster: 'Wildfire',
  cadenceSec: 1800,
  attribution:
    'Canadian Forest Service. Canadian Wildland Fire Information System (CWFIS), Natural Resources Canada, Canadian Forest Service, Northern Forestry Centre, Edmonton, Alberta. https://cwfis.cfs.nrcan.gc.ca.',
  licenseNote: 'Open Government Licence - Canada; exact citation string required',
};

const HOTSPOT_TTL_MS = 24 * 3600 * 1000; // a thermal detection is stale after a day

// CSV is unquoted simple fields (verified live); header row has spaces after
// commas ("lat, lon, rep_date, ...") so cells are trimmed. Rows with a
// mismatched column count or non-numeric lat/lon are skipped.
function parseCsv(text: string): Array<Record<string, string>> {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const rows: Array<Record<string, string>> = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',');
    if (cells.length !== headers.length) continue;
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) row[headers[j]] = cells[j].trim();
    rows.push(row);
  }
  return rows;
}

const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');

export const sync = internalAction({
  args: {},
  handler: async (ctx) => {
    const base = 'https://cwfis.cfs.nrcan.gc.ca/downloads/hotspots/';
    const now = new Date();
    // Today's UTC file may not exist yet early in the day — fall back to
    // yesterday (SOURCES.md gotcha).
    const candidates = [
      `${base}${ymd(now)}.csv`,
      `${base}${ymd(new Date(now.getTime() - 86_400_000))}.csv`,
    ];
    try {
      let text: string | undefined;
      let url = candidates[0];
      for (const candidate of candidates) {
        const res = await fetchSource(candidate);
        if (res.ok) {
          url = candidate;
          text = await res.text();
          break;
        }
        if (res.status !== 404) throw new Error(`HTTP ${res.status} for ${candidate}`);
      }
      if (text === undefined) throw new Error('hotspots CSV not found for today or yesterday');

      const fetchedAt = Date.now();
      const signals = parseCsv(text)
        .map((row) => {
          const lat = Number(row.lat);
          const lng = Number(row.lon);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
          if (!inBbox(lat, lng, VI_BBOX)) return null;
          // rep_date is "YYYY-MM-DD HH:MM:SS" UTC; unparseable → fetchedAt.
          const parsed = Date.parse(`${(row.rep_date ?? '').replace(' ', 'T')}Z`);
          const observedAt = Number.isFinite(parsed) ? parsed : fetchedAt;
          const day = new Date(observedAt).toISOString().slice(0, 10);
          const sensor = row.sensor || 'satellite';
          const summary = [
            row.fwi ? `FWI ${row.fwi}` : null,
            row.hfi ? `HFI ${row.hfi}` : null,
            row.ros ? `ROS ${row.ros}` : null,
            row.estarea ? `est ${row.estarea} ha` : null,
          ]
            .filter(Boolean)
            .join(' · ');
          return {
            sourceSlug: META.slug,
            kind: 'hotspot',
            title: `Hotspot — ${sensor} (${row.source || 'CWFIS'})`,
            summary: summary || undefined,
            // Severity: upstream CSV carries no alert field — a satellite
            // thermal anomaly (sensor MODIS/VIIRS detection) is inherently a
            // watch-grade signal: heat seen from orbit, not a confirmed
            // incident (that is bcws-fires' job). Constant 'watch'.
            severity: 'watch' as const,
            lat,
            lng,
            cell: cellOf(lat, lng),
            observedAt,
            expiresAt: observedAt + HOTSPOT_TTL_MS,
            // No upstream id — hash of stable fields: lat/lng rounded to 3
            // decimals (~100 m, finer than pixel footprint) + detection day.
            dedupeKey: `${META.slug}:${lat.toFixed(3)},${lng.toFixed(3)},${day}`,
            confidence: 0.8, // community/instrument tier: satellite detection, not agency-confirmed
            provenance: JSON.stringify({ method: 'poll', fetchedAt, url }),
            // frp is not in the current CSV schema (verified live) but kept
            // for forward-compat; fwi/hfi/ros/estarea are CWFIS's modeled
            // fire-behavior enrichment FIRMS cannot provide.
            raw: JSON.stringify({
              sensor: row.sensor,
              source: row.source,
              frp: row.frp,
              fwi: row.fwi,
              hfi: row.hfi,
              ros: row.ros,
              estarea: row.estarea,
            }),
          };
        })
        .filter((s): s is NonNullable<typeof s> => s !== null)
        .slice(0, 1000); // hard guard against a pathological upstream file
      await ctx.runMutation(internal.feeds.cwfisHotspots.ingest, { signals });
    } catch (e) {
      await ctx.runMutation(internal.feeds.cwfisHotspots.fail, { error: String(e) });
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
