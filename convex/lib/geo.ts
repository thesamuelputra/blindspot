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
