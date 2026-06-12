#!/usr/bin/env node
// Build the bus-stops index: for every BC Transit Victoria route, the ordered
// list of stops along a representative trip. Powers Samuel's "click a bus →
// see its route's stops" flow. The bus movers carry state.routeId (the GTFS
// route_id, e.g. "1-VIC") from feeds/bcTransit.ts — that's the join key the
// client uses against the JSON written here.
//
// Source: BC Transit GTFS static (operatorIds=48, Victoria regional only).
// Vendor-hosted Tmix export, no auth. Standard GTFS zip: routes.txt, trips.txt,
// stop_times.txt, stops.txt. Attribution required: "BC Transit".
//
// Why a representative trip per route (not every trip): a route runs hundreds of
// trips that mostly retrace the same stops in two directions. We pick the single
// trip with the most stops per route as the canonical shape — that captures the
// fullest stop list while keeping the JSON small (one stop array per route, not
// per trip). stop_times.txt is ~28MB, so it's streamed line-by-line rather than
// held in memory.
import { writeFileSync, mkdirSync } from 'node:fs';
import { unzipSync } from 'fflate';

const GTFS_URL = 'https://bct.tmix.se/Tmix.Cap.TdExport.WebApi/gtfs/?operatorIds=48';
const OUT = new URL('../public/data/transit-stops.json', import.meta.url);
const ATTRIBUTION = 'BC Transit';

// Strip a UTF-8 BOM that BC Transit prefixes onto the first header field.
function stripBom(s) {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

// These GTFS files have no quoted fields / embedded commas (verified against the
// live feed), so a plain split-on-comma is correct and fast. We keep the parser
// deliberately simple to handle the 28MB stop_times.txt at speed.
function parseHeader(line) {
  return stripBom(line).split(',');
}

function indexer(header, names) {
  const idx = {};
  for (const n of names) {
    const i = header.indexOf(n);
    if (i === -1) throw new Error(`missing column "${n}" — header was: ${header.join(',')}`);
    idx[n] = i;
  }
  return idx;
}

console.log(`downloading GTFS zip from ${GTFS_URL} …`);
const res = await fetch(GTFS_URL);
if (!res.ok) throw new Error(`HTTP ${res.status} fetching GTFS zip`);
const zipBuf = new Uint8Array(await res.arrayBuffer());
console.log(`got ${(zipBuf.length / 1e6).toFixed(1)} MB zip, unzipping in memory …`);

const files = unzipSync(zipBuf);
const dec = new TextDecoder('utf-8');
function text(name) {
  const bytes = files[name];
  if (!bytes) throw new Error(`zip missing ${name} — has: ${Object.keys(files).join(', ')}`);
  return dec.decode(bytes);
}

// --- stops.txt → stop_id → { name, lat, lng } ----------------------------
const stops = new Map();
{
  const lines = text('stops.txt').split('\n');
  const h = indexer(parseHeader(lines[0]), ['stop_id', 'stop_name', 'stop_lat', 'stop_lon']);
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const f = line.split(',');
    const id = f[h.stop_id];
    const lat = Number(f[h.stop_lat]);
    const lng = Number(f[h.stop_lon]);
    if (!id || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    stops.set(id, { name: f[h.stop_name], lat, lng });
  }
}
console.log(`parsed ${stops.size} stops`);

// --- routes.txt → route_id → { short, long } -----------------------------
const routes = new Map();
{
  const lines = text('routes.txt').split('\n');
  const h = indexer(parseHeader(lines[0]), [
    'route_id',
    'route_short_name',
    'route_long_name',
  ]);
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const f = line.split(',');
    const id = f[h.route_id];
    if (!id) continue;
    routes.set(id, {
      short: (f[h.route_short_name] ?? '').trim(),
      long: (f[h.route_long_name] ?? '').trim(),
    });
  }
}
console.log(`parsed ${routes.size} routes`);

// --- trips.txt → trip_id → route_id --------------------------------------
const tripRoute = new Map();
{
  const lines = text('trips.txt').split('\n');
  const h = indexer(parseHeader(lines[0]), ['route_id', 'trip_id']);
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const f = line.split(',');
    const tid = f[h.trip_id];
    const rid = f[h.route_id];
    if (!tid || !rid) continue;
    tripRoute.set(tid, rid);
  }
}
console.log(`parsed ${tripRoute.size} trips`);

// --- stop_times.txt → per-trip ordered stop lists ------------------------
// Streamed: we only retain, per trip, the ordered (by stop_sequence) stop_id
// list. To bound memory we accumulate into a Map<tripId, Array<[seq, stopId]>>.
// This is the largest file (~28MB) so we split on newlines without buffering
// the whole structure twice.
const tripStops = new Map(); // tripId -> Array<[seq, stopId]>
{
  const raw = text('stop_times.txt');
  const headerEnd = raw.indexOf('\n');
  const h = indexer(parseHeader(raw.slice(0, headerEnd)), [
    'trip_id',
    'stop_id',
    'stop_sequence',
  ]);
  let pos = headerEnd + 1;
  const len = raw.length;
  while (pos < len) {
    let nl = raw.indexOf('\n', pos);
    if (nl === -1) nl = len;
    const line = raw.slice(pos, nl);
    pos = nl + 1;
    if (!line) continue;
    const f = line.split(',');
    const tid = f[h.trip_id];
    if (!tid || !tripRoute.has(tid)) continue;
    const sid = f[h.stop_id];
    const seq = Number(f[h.stop_sequence]);
    if (!sid || !Number.isFinite(seq)) continue;
    let arr = tripStops.get(tid);
    if (!arr) {
      arr = [];
      tripStops.set(tid, arr);
    }
    arr.push([seq, sid]);
  }
}
console.log(`parsed stop_times for ${tripStops.size} trips`);

// --- pick representative trip per route (most stops) ----------------------
const bestTripPerRoute = new Map(); // routeId -> { tripId, count }
for (const [tid, arr] of tripStops) {
  const rid = tripRoute.get(tid);
  if (!rid) continue;
  const prev = bestTripPerRoute.get(rid);
  if (!prev || arr.length > prev.count) {
    bestTripPerRoute.set(rid, { tripId: tid, count: arr.length });
  }
}

// --- build the output ----------------------------------------------------
const out = {};
let totalStops = 0;
let skipped = 0;
for (const [rid, { tripId }] of bestTripPerRoute) {
  const meta = routes.get(rid);
  if (!meta) {
    skipped++;
    continue;
  }
  const ordered = tripStops
    .get(tripId)
    .slice()
    .sort((a, b) => a[0] - b[0]);
  const stopList = [];
  for (const [, sid] of ordered) {
    const s = stops.get(sid);
    if (!s) continue;
    stopList.push({ name: s.name, lat: s.lat, lng: s.lng });
  }
  if (stopList.length === 0) {
    skipped++;
    continue;
  }
  out[rid] = { short: meta.short, long: meta.long, stops: stopList };
  totalStops += stopList.length;
}

const routeCount = Object.keys(out).length;

mkdirSync(new URL('../public/data/', import.meta.url), { recursive: true });
writeFileSync(OUT, JSON.stringify(out));

const bytes = JSON.stringify(out).length;
console.log(
  `wrote public/data/transit-stops.json — ${routeCount} routes, ${totalStops} stops total, ` +
    `${(bytes / 1024).toFixed(0)} KB (attribution: ${ATTRIBUTION})`,
);
if (skipped) console.log(`(${skipped} routes skipped: no metadata or no resolvable stops)`);
