import { create } from 'zustand';

// Shared fence-drawing state (BRIEF §8.2 operator UI). Zustand, not component
// state, because two surfaces drive it: FencePanel (start / cancel / finish)
// and MapView (deck onPickClick appends vertices while drawing).

export type LngLat = [number, number];

interface FenceDrawState {
  drawing: boolean;
  points: LngLat[];
  start: () => void;
  addPoint: (lngLat: LngLat) => void;
  cancel: () => void;
  reset: () => void;
}

export const useFenceDrawState = create<FenceDrawState>((set) => ({
  drawing: false,
  points: [],
  start: () => set({ drawing: true, points: [] }),
  // no-op unless drawing: MapView guards too, but a stray call must not
  // accumulate ghost vertices into the next drawing session
  addPoint: (lngLat) => set((s) => (s.drawing ? { points: [...s.points, lngLat] } : s)),
  cancel: () => set({ drawing: false, points: [] }),
  reset: () => set({ drawing: false, points: [] }),
}));

// Close the ring (first vertex appended) and stringify as a bare GeoJSON
// Polygon — the exact shape convex/geofences.ts:create validates via
// extractFencePolygon. Null when fewer than 3 vertices (no polygon yet).
export function buildFenceGeojson(points: LngLat[]): { geojson: string } | null {
  if (points.length < 3) return null;
  const ring = [...points.map((p) => [p[0], p[1]]), [points[0][0], points[0][1]]];
  return { geojson: JSON.stringify({ type: 'Polygon', coordinates: [ring] }) };
}
