import { useQuery } from 'convex/react';
import { GeoJsonLayer, ScatterplotLayer } from '@deck.gl/layers';
import type { Feature } from 'geojson';
import { api } from '../../../convex/_generated/api';
import type { Doc } from '../../../convex/_generated/dataModel';
import { SEVERITY_RGBA, type LayerDef } from '../types';

// bcws-fires refreshes observedAt every 15-min sync; 48h window keeps
// last-known fires on the board through a feed outage without going stale.
const WINDOW_MS = 48 * 3600 * 1000;

type Fire = Doc<'signals'>;

// fire red (= SEVERITY_RGBA.critical hue) for perimeter polygons
const FIRE_RGB: [number, number, number] = [
  SEVERITY_RGBA.critical[0],
  SEVERITY_RGBA.critical[1],
  SEVERITY_RGBA.critical[2],
];

// perimeter geojson stored by convex/feeds/bcwsFires.ts: Feature with
// properties { fireNumber, status, hectares }
type PerimFeature = Feature;

function hectares(f: Fire): number {
  try {
    return (JSON.parse(f.raw ?? '{}') as { hectares?: number }).hectares ?? 0;
  } catch {
    return 0;
  }
}

export const firesLayer: LayerDef<Fire> = {
  id: 'fires',
  label: 'WILDFIRE',
  pages: ['command', 'hazard'],
  cluster: 'Wildfire',
  defaultOn: true,
  useData() {
    const data = useQuery(api.signals.byKind, { kind: 'wildfire', sinceMs: WINDOW_MS });
    return { data: data ?? [], updatedAt: data?.[0]?.observedAt };
  },
  toLayers(data) {
    // perimeter rows carry geojson (dedupeKey suffix ':perim'); point rows carry lat/lng
    const perimeters = data
      .filter((d) => d.geojson != null)
      .flatMap((d): PerimFeature[] => {
        try {
          return [JSON.parse(d.geojson ?? '') as PerimFeature];
        } catch {
          return [];
        }
      });
    const points = data.filter((d) => d.geojson == null && d.lat != null && d.lng != null);
    return [
      // perimeters first → rendered under the points
      new GeoJsonLayer({
        id: 'fires-perimeters',
        data: perimeters,
        filled: true,
        getFillColor: [...FIRE_RGB, 40],
        stroked: true,
        getLineColor: [...FIRE_RGB, 220],
        lineWidthMinPixels: 1,
        pickable: true,
      }),
      new ScatterplotLayer<Fire>({
        id: 'fires-points',
        data: points,
        getPosition: (d) => [d.lng ?? 0, d.lat ?? 0],
        // hectares is an area → sqrt scale keeps marker area ∝ fire size
        getRadius: (d) => 300 + 120 * Math.sqrt(hectares(d)),
        radiusUnits: 'meters',
        radiusMinPixels: 3,
        radiusMaxPixels: 36,
        getFillColor: (d) => SEVERITY_RGBA[d.severity] ?? SEVERITY_RGBA.info,
        stroked: true,
        getLineColor: [230, 234, 240, 60],
        lineWidthMinPixels: 0.5,
        pickable: true,
      }),
    ];
  },
};
