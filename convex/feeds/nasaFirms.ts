import { v } from 'convex/values';
import { internalAction, internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { fetchSource } from '../lib/fetchSource';
import { VI_BBOX, inBbox, cellOf } from '../lib/geo';
import { upsertSignals, reportSuccess, reportFailure, type SourceMeta } from '../lib/ingest';

// nasa-firms — SOURCES.md: Wildfire. KEYLESS Canada-wide 24h VIIRS active-fire
// CSVs (verified live; NOT the MAP_KEY area API): Suomi NPP + NOAA-20 files,
// each Canada-wide and bbox-filtered server-side. Files regenerate roughly
// hourly. Worst case: peak fire season the national files run to tens of
// thousands of rows; the VI bbox subset stays in the low hundreds — hard
// capped at 1000/sync. Empty bbox in fair weather is SUCCESS with count 0.
// No auth. Cadence: medium lane (1800s). Renders via the cwfis hotspots layer.
const META: SourceMeta = {
  slug: 'nasa-firms',
  name: 'NASA FIRMS VIIRS Hotspots',
  cluster: 'Wildfire',
  cadenceSec: 1800,
  attribution:
    "We acknowledge the use of data from NASA's Fire Information for Resource Management System (FIRMS) (https://earthdata.nasa.gov/firms), part of NASA's Earth Science Data and Information System (ESDIS).",
  licenseNote: 'NASA open data policy — no restrictions; FIRMS requests acknowledgment',
};

// Keyless per-satellite Canada 24h files (SOURCES.md `nasa-firms`, verified).
const CSV_URLS = [
  'https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Canada_24h.csv',
  'https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Canada_24h.csv',
];

const HOTSPOT_TTL_MS = 24 * 3600 * 1000; // detections age out with the 24h rolling file

// Upstream `satellite` codes seen live: N = Suomi NPP, N20 = NOAA-20
// (SOURCES.md's "(N/J)" note is stale — the J1 file reports N20).
const SATELLITE_NAME: Record<string, string> = {
  N: 'Suomi NPP',
  N20: 'NOAA-20',
  N21: 'NOAA-21',
};

// CSV is simple unquoted fields, no embedded commas (verified live). Header:
// latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,
// confidence,version,bright_ti5,frp,daynight. Malformed rows are skipped.
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

export const sync = internalAction({
  args: {},
  handler: async (ctx) => {
    try {
      // Fetch both satellite files; tolerate one being down as long as the
      // other answers (each is an independent S3-style object upstream).
      const texts: Array<{ url: string; text: string }> = [];
      const errors: string[] = [];
      for (const url of CSV_URLS) {
        try {
          const res = await fetchSource(url);
          if (!res.ok) {
            errors.push(`HTTP ${res.status} for ${url}`);
            continue;
          }
          texts.push({ url, text: await res.text() });
        } catch (e) {
          errors.push(`${String(e)} for ${url}`);
        }
      }
      if (texts.length === 0) throw new Error(errors.join('; ') || 'no FIRMS CSV fetched');

      const fetchedAt = Date.now();
      const byKey = new Map<string, NonNullable<ReturnType<typeof toSignal>>>();
      for (const { url, text } of texts) {
        for (const row of parseCsv(text)) {
          const signal = toSignal(row, url, fetchedAt);
          if (signal) byKey.set(signal.dedupeKey, signal);
        }
      }
      const signals = [...byKey.values()].slice(0, 1000); // hard guard
      await ctx.runMutation(internal.feeds.nasaFirms.ingest, { signals });
    } catch (e) {
      await ctx.runMutation(internal.feeds.nasaFirms.fail, { error: String(e) });
    }
  },
});

function toSignal(row: Record<string, string>, url: string, fetchedAt: number) {
  const lat = Number(row.latitude);
  const lng = Number(row.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (!inBbox(lat, lng, VI_BBOX)) return null;
  // acq_date "YYYY-MM-DD" + acq_time "HHMM" (UTC, zero-padded, verified live).
  const t = (row.acq_time ?? '').padStart(4, '0');
  const parsed = Date.parse(`${row.acq_date}T${t.slice(0, 2)}:${t.slice(2, 4)}:00Z`);
  const observedAt = Number.isFinite(parsed) ? parsed : fetchedAt;
  const satellite = SATELLITE_NAME[row.satellite] ?? row.satellite ?? 'VIIRS';
  const frp = row.frp ? `FRP ${row.frp} MW` : null;
  const summary =
    [frp, row.confidence ? `confidence ${row.confidence}` : null, row.daynight === 'N' ? 'night pass' : null]
      .filter(Boolean)
      .join(' · ') || undefined;
  return {
    sourceSlug: META.slug,
    kind: 'hotspot',
    title: `Hotspot — VIIRS (${satellite})`,
    summary,
    // Severity: upstream `confidence` (nominal/low/high) grades detection
    // quality, not threat — a satellite thermal anomaly is heat seen from
    // orbit, not a confirmed incident (bcws-fires owns that), so constant
    // 'watch' regardless of confidence, matching the cwfis hotspot feed.
    severity: 'watch' as const,
    lat,
    lng,
    cell: cellOf(lat, lng),
    observedAt,
    expiresAt: observedAt + HOTSPOT_TTL_MS,
    // No upstream id — pixel identity is its position + acquisition instant.
    dedupeKey: `${META.slug}:${row.latitude},${row.longitude},${row.acq_date},${row.acq_time}`,
    confidence: 0.8, // community-instrument tier: satellite detection, not agency-confirmed
    provenance: JSON.stringify({ method: 'poll', fetchedAt, url }),
    raw: JSON.stringify({
      satellite: row.satellite,
      frp: row.frp,
      confidence: row.confidence, // as upstream reports it: nominal/low/high
    }),
  };
}

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
