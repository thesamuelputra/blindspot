import { useQuery } from 'convex/react';
import type { Layer } from '@deck.gl/core';
import { GeoJsonLayer, PathLayer, ScatterplotLayer } from '@deck.gl/layers';
import { PathStyleExtension, type PathStyleExtensionProps } from '@deck.gl/extensions';
import type { Feature, Geometry } from 'geojson';
import { api } from '../../../convex/_generated/api';
import type { Doc } from '../../../convex/_generated/dataModel';
import type { LayerDef } from '@/layers/types';
import type { LngLat } from './fenceStore';

// Geofence overlay (BRIEF §8.2): active fences render as dashed violet
// outlines — the intel accent, dashed so they read as operator-drawn
// tripwires rather than ingested data. Management lives in FencePanel;
// the layer itself is not pickable so clicks pass through to movers.

type Fence = Doc<'geofences'>;

const violet = (alpha: number): [number, number, number, number] => [167, 139, 250, alpha]; // --intel

interface FenceProps {
  name: string;
  rule: Fence['rule'];
  severity: Fence['severity'];
}

// Stored geojson is a bare Polygon from FencePanel, but auto-fences (fire
// buffers) may store a Feature/FeatureCollection — mirror the server-side
// extractor (convex/brain/geofence.ts) and dig out the first polygonal
// geometry. Unparseable rows are skipped; they still show in the panel.
interface LooseGeoJson {
  type?: string;
  geometry?: LooseGeoJson | null;
  features?: LooseGeoJson[];
  coordinates?: unknown;
}

function findGeometry(g: LooseGeoJson | null | undefined): Geometry | null {
  if (!g || typeof g !== 'object') return null;
  if ((g.type === 'Polygon' || g.type === 'MultiPolygon') && g.coordinates)
    return g as unknown as Geometry;
  if (g.type === 'Feature') return findGeometry(g.geometry);
  if (g.type === 'FeatureCollection' && Array.isArray(g.features)) {
    for (const f of g.features) {
      const hit = findGeometry(f);
      if (hit) return hit;
    }
  }
  return null;
}

function toFeatures(rows: Fence[]): Feature<Geometry, FenceProps>[] {
  const features: Feature<Geometry, FenceProps>[] = [];
  for (const f of rows) {
    try {
      const geometry = findGeometry(JSON.parse(f.geojson) as LooseGeoJson);
      if (!geometry) continue;
      features.push({
        type: 'Feature',
        geometry,
        properties: { name: f.name, rule: f.rule, severity: f.severity },
      });
    } catch {
      // malformed fence geojson: skip on the map
    }
  }
  return features;
}

export const fencesLayer: LayerDef<Fence> = {
  id: 'fences',
  label: 'FENCES',
  pages: ['command', 'skies-seas', 'ground'],
  cluster: 'Brain (Derived)',
  defaultOn: true,
  useData() {
    const data = useQuery(api.geofences.list, {});
    // render active fences only; the panel manages the full inventory
    const rows = (data ?? []).filter((f) => f.active);
    const newest = rows.reduce((m, f) => Math.max(m, f._creationTime), 0);
    return { data: rows, updatedAt: newest || undefined };
  },
  toLayers(data) {
    return [
      new GeoJsonLayer<FenceProps, PathStyleExtensionProps>({
        id: 'fences',
        data: toFeatures(data),
        filled: true,
        getFillColor: violet(14), // barely-there wash so the interior reads as inside
        stroked: true,
        getLineColor: violet(220),
        lineWidthMinPixels: 1.5,
        getDashArray: [6, 4],
        extensions: [new PathStyleExtension({ dash: true, highPrecisionDash: true })],
        pickable: false,
      }),
    ];
  },
};

// In-progress drawing preview (MapView pushes this while the fence store is
// in drawing mode): the clicked vertices plus the ring they would close into
// once 3+ points exist. Same dashed violet language as committed fences.
export function buildFencePreviewLayer(points: LngLat[]): Layer[] {
  if (points.length === 0) return [];
  const layers: Layer[] = [];
  if (points.length >= 2) {
    const path: LngLat[] = points.length >= 3 ? [...points, points[0]] : [...points];
    layers.push(
      new PathLayer<{ path: LngLat[] }, PathStyleExtensionProps>({
        id: 'fence-preview-ring',
        data: [{ path }],
        getPath: (d) => d.path,
        getColor: violet(235),
        getWidth: 1.5,
        widthUnits: 'pixels',
        capRounded: true,
        jointRounded: true,
        getDashArray: [4, 3],
        extensions: [new PathStyleExtension({ dash: true, highPrecisionDash: true })],
      }),
    );
  }
  layers.push(
    new ScatterplotLayer<LngLat>({
      id: 'fence-preview-vertices',
      data: points,
      getPosition: (d) => d,
      getFillColor: violet(255),
      radiusUnits: 'pixels',
      getRadius: 3,
    }),
  );
  return layers;
}
