import { v } from 'convex/values';
import { internalAction, internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { fetchSource } from '../lib/fetchSource';
import {
  insertReadings,
  reportSuccess,
  reportFailure,
  type ReadingInput,
  type SourceMeta,
} from '../lib/ingest';
import { writeSnapshot } from '../lib/movers';

// bc-snow — SOURCES.md: Infrastructure / Network / Cyber. BC Automated Snow
// Weather Stations (ASWS), keyless hourly CSVs covering the water year to
// date: SW.csv = snow water equivalent (mm), SD.csv = snow depth (cm).
// Wide format verified live 2026-06-11: col 0 'DATE(UTC)' (yyyy-mm-dd hh:mm),
// then one column per station named '<ID> <Name>' (no commas in names, no
// quoting). VI stations = snow basin code 3B (Wolf River Upper, Jump Creek,
// Heather Mountain Upper, Mount Arrowsmith, Cobble Hill, Survey Mountain in
// SW; SD additionally has Martins Gulch + Sooke Dam but lacks Wolf River).
// Station columns appear/disappear between water years, so columns are
// matched by the 3B prefix at parse time, never hardcoded. Files are ~3 MB
// each — only the trailing 48 hourly rows are scanned (values older than
// that mean the sensor is not reporting, so the station is skipped).
// SEASONAL: VI SWE is zero/near-zero through summer — a sync full of 0 mm
// readings (or stations entirely silent) is SUCCESS, not failure.
// Worst case: ~9 stations × 2 metrics = 18 readings/sync + one snapshot.
// Cadence: slow lane (21600s; underlying data is hourly, poll gently).
const META: SourceMeta = {
  slug: 'bc-snow',
  name: 'BC Automated Snow Weather Stations',
  cluster: 'Infrastructure / Network / Cyber',
  cadenceSec: 21600,
  attribution:
    'Contains information licensed under the Open Government Licence - British Columbia (BC Ministry of Environment / River Forecast Centre)',
  licenseNote: 'Open Government Licence - British Columbia',
};

const SWE_URL = 'https://www.env.gov.bc.ca/wsd/data_searches/snow/asws/data/SW.csv';
const DEPTH_URL = 'https://www.env.gov.bc.ca/wsd/data_searches/snow/asws/data/SD.csv';

// Values older than this are a silent sensor, not a current reading.
const MAX_LOOKBACK_ROWS = 48; // hourly rows ≈ 48 h

// Station coordinates verified live 2026-06-11 from the authoritative BC
// open data layer (openmaps.gov.bc.ca WFS, WHSE_WATER_MANAGEMENT.
// SSL_SNOW_ASWS_STNS_SP, EPSG:4326). The CSVs carry no geometry. A new 3B
// station missing here still produces readings — it just gets no map dot
// until this table is refreshed. 3B25P (Malaview Test ASWS) is deliberately
// excluded: test station, absent from the data files.
const COORDS: Record<string, { lat: number; lng: number }> = {
  '3B17P': { lat: 49.7041389, lng: -125.67925 }, // Wolf River Upper
  '3B23P': { lat: 48.969505, lng: -124.276182 }, // Jump Creek
  '3B24P': { lat: 48.943875, lng: -124.452113 }, // Heather Mountain Upper
  '3B26P': { lat: 49.207376, lng: -124.567776 }, // Mount Arrowsmith
  '3B27P': { lat: 48.69899, lng: -123.59287 }, // Cobble Hill
  '3B28P': { lat: 48.580278, lng: -123.840556 }, // Chris Creek
  '3B29P': { lat: 48.516111, lng: -123.764444 }, // Martins Gulch
  '3B30P': { lat: 48.516111, lng: -123.700556 }, // Sooke Dam
  '3B31P': { lat: 48.559167, lng: -123.799167 }, // Survey Mountain
};

interface StationSample {
  id: string; // '3B23P'
  label: string; // 'Jump Creek'
  value: number;
  at: number;
}

// 'DATE(UTC)' values look like '2026-06-11 13:00' — UTC, no zone marker.
function parseUtc(s: string): number {
  return Date.parse(s.trim().replace(' ', 'T') + ':00Z');
}

// Latest sample per VI (3B-prefixed) station column, scanning the trailing
// rows backwards — trailing cells go blank independently per column as
// stations report at different minutes past the hour.
function latestViSamples(csv: string): StationSample[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const header = lines[0].split(',');
  const tail = lines.slice(-MAX_LOOKBACK_ROWS).map((l) => l.split(','));
  const samples: StationSample[] = [];
  for (let col = 1; col < header.length; col++) {
    const name = header[col].trim();
    if (!name.startsWith('3B')) continue; // 3B = Vancouver Island snow basin
    const sp = name.indexOf(' ');
    const id = sp > 0 ? name.slice(0, sp) : name;
    const label = sp > 0 ? name.slice(sp + 1) : name;
    for (let i = tail.length - 1; i >= 0; i--) {
      const cell = (tail[i][col] ?? '').trim();
      if (cell === '') continue;
      const value = parseFloat(cell);
      const at = parseUtc(tail[i][0] ?? '');
      if (Number.isFinite(value) && Number.isFinite(at)) {
        samples.push({ id, label, value, at });
      }
      break; // most recent non-blank cell decides, parseable or not
    }
  }
  return samples;
}

interface SnapshotStation {
  id: string;
  label: string;
  lat: number;
  lng: number;
  value: number;
  unit: string;
  at: number;
}

export const sync = internalAction({
  args: {},
  handler: async (ctx) => {
    // Tolerate one file failing as long as the other parses (independent
    // static objects upstream).
    const results = await Promise.allSettled(
      [SWE_URL, DEPTH_URL].map(async (url) => {
        const res = await fetchSource(url);
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
        return latestViSamples(await res.text());
      }),
    );
    const errors: string[] = [];
    const [sweRes, depthRes] = results;
    if (sweRes.status === 'rejected') errors.push(String(sweRes.reason));
    if (depthRes.status === 'rejected') errors.push(String(depthRes.reason));
    if (sweRes.status === 'rejected' && depthRes.status === 'rejected') {
      await ctx.runMutation(internal.feeds.bcSnow.fail, { error: errors.join('; ') });
      return;
    }

    const swe = sweRes.status === 'fulfilled' ? sweRes.value : [];
    const depth = depthRes.status === 'fulfilled' ? depthRes.value : [];

    const readings: ReadingInput[] = [];
    for (const s of swe) {
      readings.push({
        stationId: `${META.slug}:${s.id}`,
        metric: 'swe',
        value: s.value,
        unit: 'mm',
        at: s.at,
        lat: COORDS[s.id]?.lat,
        lng: COORDS[s.id]?.lng,
        sourceSlug: META.slug,
      });
    }
    for (const s of depth) {
      readings.push({
        stationId: `${META.slug}:${s.id}`,
        metric: 'snow_depth',
        value: s.value,
        unit: 'cm',
        at: s.at,
        lat: COORDS[s.id]?.lat,
        lng: COORDS[s.id]?.lng,
        sourceSlug: META.slug,
      });
    }

    // Snapshot headline is SWE (mm) — the operationally meaningful number
    // (Jump Creek feeds Nanaimo's water supply). Depth-only stations get
    // readings but no dot.
    const stations: SnapshotStation[] = swe
      .filter((s) => COORDS[s.id])
      .map((s) => ({
        id: s.id,
        label: s.label,
        lat: COORDS[s.id].lat,
        lng: COORDS[s.id].lng,
        value: s.value,
        unit: 'mm',
        at: s.at,
      }));

    await ctx.runMutation(internal.feeds.bcSnow.ingest, { readings, stations });
  },
});

export const ingest = internalMutation({
  args: { readings: v.array(v.any()), stations: v.array(v.any()) },
  handler: async (ctx, { readings, stations }) => {
    const inserted = await insertReadings(ctx, readings as ReadingInput[]);
    await writeSnapshot(ctx, `stations:${META.slug}`, JSON.stringify(stations));
    await reportSuccess(ctx, META, readings.length);
    return { inserted };
  },
});

export const fail = internalMutation({
  args: { error: v.string() },
  handler: async (ctx, { error }) => {
    await reportFailure(ctx, META, error);
  },
});
