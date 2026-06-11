// Canonical Vancouver Island bbox — DECISIONS D11. Mirrors src/lib/bbox.ts and
// the AIS worker constant; change all three together.
export const VI_BBOX = {
  south: 48.2,
  west: -125.3,
  north: 51.1,
  east: -123.1,
} as const;

export const CASCADIA_BBOX = {
  south: 46.0,
  west: -132.0,
  north: 52.0,
  east: -121.0,
} as const;

export function inBbox(
  lat: number,
  lng: number,
  bbox: { south: number; west: number; north: number; east: number } = VI_BBOX,
): boolean {
  return lat >= bbox.south && lat <= bbox.north && lng >= bbox.west && lng <= bbox.east;
}

// 0.2° proximity bucket for signals.cell (ARCHITECTURE §3).
export function cellOf(lat: number, lng: number): string {
  const snap = (n: number) => (Math.round(n / 0.2) * 0.2).toFixed(1);
  return `${snap(lat)},${snap(lng)}`;
}

// Coarse Vancouver Island + Gulf Islands land/waters polygon (lng,lat) —
// trims the mainland sliver (Richmond/Delta/Sunshine Coast) that the raw
// bbox corner admits (BRIEF §0 constraint 1). Deliberately rough; only for
// feeds where mainland bleed-through is visible (AUDIT Phase 6).
const ISLAND_POLY: Array<[number, number]> = [
  [-125.3, 48.2],
  [-123.0, 48.2],
  [-122.98, 48.9],
  [-123.55, 49.4],
  [-124.4, 49.9],
  [-124.8, 50.4],
  [-125.3, 50.9],
  [-125.3, 48.2],
];

export function onIslandSide(lat: number, lng: number): boolean {
  // even-odd point-in-polygon over ISLAND_POLY
  let inside = false;
  for (let i = 0, j = ISLAND_POLY.length - 1; i < ISLAND_POLY.length; j = i++) {
    const [xi, yi] = ISLAND_POLY[i];
    const [xj, yj] = ISLAND_POLY[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Haversine distance in meters — used by the track displacement gate (§11).
export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
