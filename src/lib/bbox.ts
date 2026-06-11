// Canonical Vancouver Island bbox — DECISIONS D11. Mirrored in convex/lib/geo.ts
// and workers/ais (each runtime keeps its own copy; change all three together).
export const VI_BBOX = {
  south: 48.2,
  west: -125.3,
  north: 51.1,
  east: -123.1,
} as const;

export const VI_CENTER = { lat: 49.35, lng: -124.4 } as const;

// Wider box used deliberately by Cascadia seismic feeds (offshore events matter).
export const CASCADIA_BBOX = {
  south: 46.0,
  west: -132.0,
  north: 52.0,
  east: -121.0,
} as const;
