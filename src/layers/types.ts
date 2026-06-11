import type { Layer } from '@deck.gl/core';

// Layer registry contract (ARCHITECTURE §10). Every map layer is one LayerDef;
// the rail, counts, freshness chips and ⌘K all derive from the registry —
// pages never hand-wire deck.gl.
export interface LayerData<T = unknown> {
  data: T[];
  updatedAt?: number; // newest observedAt, for the "updated Xs ago" chip
}

// Browser-direct raster overlay (GeoMet WMS etc. — CORS-open, no Convex hop).
// MapShell owns source lifecycle + cache-bust refresh; inserted below labels.
export interface RasterSpec {
  tiles: string[]; // tile URL template(s) with {bbox-epsg-3857}
  tileSize?: number;
  opacity?: number;
  refreshSec?: number; // re-bust cadence (match upstream frame rate)
  attribution: string;
}

export interface LayerDef<T = unknown> {
  id: string;
  label: string; // rail label, uppercase micro style
  pages: string[]; // route ids this layer appears on ("command" is the master map)
  cluster: string; // SOURCES.md cluster (SYSTEM page cross-link)
  defaultOn: boolean;
  // deck path (data layers) — present unless this is a pure raster overlay
  useData?(): LayerData<T>; // wraps convex useQuery; must be a hook
  toLayers?(data: T[]): Layer[];
  // raster path
  raster?: RasterSpec;
}

// Severity → accent mapping (tokens.css). RGBA arrays for deck.gl.
export const SEVERITY_RGBA: Record<string, [number, number, number, number]> = {
  info: [91, 101, 115, 200], // text-3 grey — ambient
  watch: [245, 158, 11, 210], // amber
  warning: [245, 158, 11, 255], // amber, full
  critical: [239, 68, 68, 255], // red
};

export const ACCENT_LIVE: [number, number, number, number] = [56, 189, 248, 255];
