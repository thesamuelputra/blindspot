import { useCallback } from 'react';
import { buildFenceGeojson, useFenceDrawState, type LngLat } from './fenceStore';

// Fence draw state machine, hook-shaped. A thin facade over useFenceDrawState
// (the shared zustand store in ./fenceStore) rather than local useState: the
// panel and the map are separate component trees, so the vertex list must
// live in shared state for map clicks to land where the panel can see them.

export interface FenceDraw {
  drawing: boolean;
  points: LngLat[];
  start: () => void;
  cancel: () => void;
  addPoint: (lngLat: LngLat) => void;
  // Closes the ring (first point appended) and returns the stringified
  // GeoJSON Polygon, resetting the draw state. Null when fewer than 3
  // points; state is left untouched so the operator can keep clicking.
  finish: () => { geojson: string } | null;
}

export function useFenceDraw(): FenceDraw {
  const drawing = useFenceDrawState((s) => s.drawing);
  const points = useFenceDrawState((s) => s.points);
  const start = useFenceDrawState((s) => s.start);
  const cancel = useFenceDrawState((s) => s.cancel);
  const addPoint = useFenceDrawState((s) => s.addPoint);

  const finish = useCallback(() => {
    const out = buildFenceGeojson(useFenceDrawState.getState().points);
    if (out) useFenceDrawState.getState().reset();
    return out;
  }, []);

  return { drawing, points, start, cancel, addPoint, finish };
}
