// BlindSpot AIS worker — DECISIONS D2 / ARCHITECTURE §6.
// Holds the aisstream.io websocket (Convex can't), thins to one position per
// vessel per 30s, batch-POSTs to the Convex httpAction every 30s.
// Host-agnostic: Fly.io / Railway / any always-on box. Env:
//   AISSTREAM_KEY     — from aisstream.io (GitHub sign-in)
//   CONVEX_SITE_URL   — https://<deployment>.convex.site
//   INGEST_SECRET     — shared bearer secret (same value in Convex env)
import WebSocket from 'ws';

const { AISSTREAM_KEY, CONVEX_SITE_URL, INGEST_SECRET } = process.env;
if (!AISSTREAM_KEY || !CONVEX_SITE_URL || !INGEST_SECRET) {
  console.error('missing env: need AISSTREAM_KEY, CONVEX_SITE_URL, INGEST_SECRET');
  process.exit(1);
}

// VI bbox — mirror of convex/lib/geo.ts and src/lib/bbox.ts (D11).
const BBOX = [[[48.2, -125.3], [51.1, -123.1]]];

const FLUSH_MS = 30_000;
const STALE_SOCKET_MS = 90_000;

/** @type {Map<string, {lat:number,lng:number,heading?:number,speed?:number,name?:string,shipType?:number,dest?:string,at:number,dirty:boolean}>} */
const vessels = new Map();
let lastMessageAt = Date.now();
let backoff = 1_000;

function connect() {
  const ws = new WebSocket('wss://stream.aisstream.io/v0/stream');

  ws.on('open', () => {
    // subscription must arrive within 3s of connect (verified in SOURCES.md)
    ws.send(
      JSON.stringify({
        APIKey: AISSTREAM_KEY,
        BoundingBoxes: BBOX,
        FilterMessageTypes: ['PositionReport', 'ShipStaticData'],
      }),
    );
    backoff = 1_000;
    console.log('aisstream connected, subscribed to VI bbox');
  });

  ws.on('message', (buf) => {
    lastMessageAt = Date.now();
    let msg;
    try {
      msg = JSON.parse(buf.toString());
    } catch {
      return;
    }
    const meta = msg.MetaData;
    if (!meta?.MMSI) return;
    const id = String(meta.MMSI);
    const v = vessels.get(id) ?? { lat: 0, lng: 0, at: 0, dirty: false };

    if (msg.MessageType === 'PositionReport') {
      const p = msg.Message?.PositionReport;
      if (!p) return;
      v.lat = p.Latitude;
      v.lng = p.Longitude;
      v.heading = p.TrueHeading >= 0 && p.TrueHeading < 360 ? p.TrueHeading : p.Cog;
      v.speed = p.Sog;
      v.at = Date.now();
      v.dirty = true;
      if (meta.ShipName?.trim()) v.name = meta.ShipName.trim();
    } else if (msg.MessageType === 'ShipStaticData') {
      const s = msg.Message?.ShipStaticData;
      if (!s) return;
      if (s.Name?.trim()) v.name = s.Name.trim();
      v.shipType = s.Type;
      if (s.Destination?.trim()) v.dest = s.Destination.trim();
    }
    vessels.set(id, v);
  });

  ws.on('close', () => retry('socket closed'));
  ws.on('error', (e) => {
    console.error('socket error:', e.message);
    ws.terminate();
  });

  function retry(why) {
    const wait = backoff + Math.random() * 1_000;
    backoff = Math.min(backoff * 2, 60_000);
    console.log(`${why}; reconnecting in ${Math.round(wait / 1000)}s`);
    setTimeout(connect, wait);
  }

  return ws;
}

async function flush() {
  // AUDIT (Phase 6): the Convex snapshot is REPLACED per batch, so a
  // dirty-only batch made quiet vessels flicker off the map. Send the full
  // non-stale roster whenever anything changed; dirty only gates the POST.
  const cutoff = Date.now() - 10 * 60_000;
  let anyDirty = false;
  const batch = [];
  for (const [mmsi, v] of vessels) {
    if (v.at < cutoff) {
      vessels.delete(mmsi); // left the area / went dark — drop locally
      continue;
    }
    if (v.dirty) anyDirty = true;
    batch.push({
      extId: mmsi,
      label: v.name ?? mmsi,
      lat: v.lat,
      lng: v.lng,
      heading: v.heading,
      speed: v.speed,
      state: JSON.stringify({ shipType: v.shipType, dest: v.dest }),
      at: v.at,
    });
    v.dirty = false;
  }
  if (batch.length === 0 || !anyDirty) return;
  try {
    const res = await fetch(`${CONVEX_SITE_URL}/ingest/ais`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${INGEST_SECRET}`,
      },
      body: JSON.stringify({ vessels: batch }),
    });
    if (!res.ok) console.error(`ingest HTTP ${res.status}`);
    else console.log(`flushed ${batch.length} vessels`);
  } catch (e) {
    console.error('ingest failed:', e.message);
  }
}

let socket = connect();
setInterval(flush, FLUSH_MS);
setInterval(() => {
  if (Date.now() - lastMessageAt > STALE_SOCKET_MS) {
    console.log('no messages for 90s — recycling socket');
    lastMessageAt = Date.now();
    socket.terminate();
    socket = connect();
  }
}, STALE_SOCKET_MS);
