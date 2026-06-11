import { useQuery } from 'convex/react';
import { ScatterplotLayer } from '@deck.gl/layers';
import { api } from '../../../convex/_generated/api';
import type { Doc } from '../../../convex/_generated/dataModel';
import type { LayerDef } from '../types';

// Satellite thermal detections. This def serves kind 'hotspot' from ALL
// sources (cwfis AND nasa-firms write the same kind) — it is a kind-level
// layer, not a per-source one.
const WINDOW_MS = 24 * 3600 * 1000; // detections older than a day are stale

// Amber-red hotspot tint — deliberately hotter than SEVERITY watch amber so
// thermal detections read as "heat" next to amber weather/advisory marks.
const HOTSPOT_RGBA: [number, number, number, number] = [245, 120, 11, 200];

type Hotspot = Doc<'signals'>;

export const hotspotsLayer: LayerDef<Hotspot> = {
  id: 'hotspots',
  label: 'HOTSPOTS',
  pages: ['command', 'hazard'],
  cluster: 'Wildfire',
  defaultOn: true,
  useData() {
    const data = useQuery(api.signals.byKind, { kind: 'hotspot', sinceMs: WINDOW_MS });
    return { data: data ?? [], updatedAt: data?.[0]?.observedAt };
  },
  toLayers(data) {
    return [
      new ScatterplotLayer<Hotspot>({
        id: 'hotspots',
        data,
        getPosition: (d) => [d.lng ?? 0, d.lat ?? 0],
        // ~375 m ≈ VIIRS pixel half-width; pixel clamps keep the marks as
        // small squares-at-a-glance dots at any zoom.
        getRadius: 375,
        radiusUnits: 'meters',
        radiusMinPixels: 2,
        radiusMaxPixels: 6,
        getFillColor: HOTSPOT_RGBA,
        pickable: true,
      }),
    ];
  },
};
