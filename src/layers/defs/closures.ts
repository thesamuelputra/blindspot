import { useQuery } from 'convex/react';
import { GeoJsonLayer } from '@deck.gl/layers';
import type { Feature, FeatureCollection, Geometry, Polygon } from 'geojson';
import { api } from '../../../convex/_generated/api';
import type { Doc } from '../../../convex/_generated/dataModel';
import { SEVERITY_RGBA, type LayerDef } from '../types';

// dfo-closures refreshes observedAt every daily sync; a 3-day window keeps the
// active set visible across a missed sync or two while letting revoked orders
// (which vanish from the upstream layer and stop refreshing) age out.
const WINDOW_MS = 3 * 24 * 3600 * 1000;

type Closure = Doc<'signals'>;

interface EchoZoneProps {
  name: string;
  restriction: string;
  source: string;
}

interface ClosureProps {
  title: string;
  summary?: string;
  dedupeKey: string;
}

// echo-slowdown — SOURCES.md: Seas (Marine). Static geometry only: no feed
// module. Coordinates hand-transcribed from Transport Canada's Interim Order
// for the Protection of the Killer Whale (2026 edition, page dated 2026-05-22,
// in force Jun 1 – Nov 30 2026), degrees-decimal-minutes converted to decimal
// degrees. The order is redrawn annually — re-extract every June. Notes:
// - Nitinat SRZ's eastern edge runs "along the coastline" from Carmanah Point
//   back to the NW corner in the order text; approximated here with a straight
//   segment (info overlay, not navigation-grade).
// - The ECHO program's voluntary Haro Strait/Boundary Pass lane polygons are
//   NOT included: they only exist in Port of Vancouver Notice-to-Industry PDFs
//   that are bot-blocked (per SOURCES.md) — digitize manually when grabbed.
const ECHO_ZONES_2026: FeatureCollection<Polygon, EchoZoneProps> = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {
        name: 'Swiftsure Bank Speed Restricted Zone',
        restriction: 'Mandatory 10 kn',
        source: 'Transport Canada Interim Order 2026 (Jun 1 – Nov 30)',
      },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-125.1, 48.566667],
            [-125.029333, 48.535],
            [-124.82575, 48.535],
            [-124.77655, 48.533617],
            [-124.724717, 48.519167],
            [-124.717783, 48.595283],
            [-124.903167, 48.566667],
            [-125.1, 48.566667],
          ],
        ],
      },
    },
    {
      type: 'Feature',
      properties: {
        name: 'Mouth of the Nitinat River Speed Restricted Zone',
        restriction: 'Mandatory 10 kn',
        source: 'Transport Canada Interim Order 2026 (Jun 1 – Nov 30)',
      },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-125.0, 48.706283],
            [-125.0, 48.611383],
            [-124.751383, 48.611383], // Carmanah Point; coastline edge approximated
            [-125.0, 48.706283],
          ],
        ],
      },
    },
    {
      type: 'Feature',
      properties: {
        name: 'Pender Island Vessel Restricted Zone',
        restriction: 'No-go (interim order exemptions apply)',
        source: 'Transport Canada Interim Order 2026 (Jun 1 – Nov 30)',
      },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-123.321667, 48.763617],
            [-123.31445, 48.770283],
            [-123.23195, 48.736117],
            [-123.258617, 48.735883],
            [-123.321667, 48.763617],
          ],
        ],
      },
    },
    {
      type: 'Feature',
      properties: {
        name: 'Saturna Island Vessel Restricted Zone',
        restriction: 'No-go (interim order exemptions apply)',
        source: 'Transport Canada Interim Order 2026 (Jun 1 – Nov 30)',
      },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-123.04555, 48.785833],
            [-123.048583, 48.78945],
            [-123.041383, 48.793617],
            [-123.032917, 48.791217],
            [-123.05245, 48.775967],
            [-123.063417, 48.772217],
            [-123.085833, 48.7725],
            [-123.085833, 48.77805],
            [-123.04555, 48.785833],
          ],
        ],
      },
    },
  ],
};

// Closures without geometry (or with unparseable geojson) are skipped — they
// still surface via the feed, just not as map polygons.
function toFeatures(closures: Closure[]): Feature<Geometry, ClosureProps>[] {
  const features: Feature<Geometry, ClosureProps>[] = [];
  for (const c of closures) {
    if (!c.geojson) continue;
    try {
      features.push({
        type: 'Feature',
        geometry: JSON.parse(c.geojson) as Geometry,
        properties: { title: c.title, summary: c.summary, dedupeKey: c.dedupeKey },
      });
    } catch {
      // malformed geojson: skip this closure
    }
  }
  return features;
}

const INFO = SEVERITY_RGBA.info;

export const closuresLayer: LayerDef<Closure> = {
  id: 'closures',
  label: 'CLOSURES',
  pages: ['command', 'skies-seas'],
  cluster: 'Seas (Marine)',
  defaultOn: false,
  useData() {
    const data = useQuery(api.signals.byKind, { kind: 'closure-fishery', sinceMs: WINDOW_MS });
    return { data: data ?? [], updatedAt: data?.[0]?.observedAt };
  },
  toLayers(data) {
    return [
      // DFO shellfish prohibition orders — quiet info-grey fills
      new GeoJsonLayer<ClosureProps>({
        id: 'closures-fishery',
        data: toFeatures(data),
        filled: true,
        getFillColor: [INFO[0], INFO[1], INFO[2], 30],
        stroked: true,
        getLineColor: [INFO[0], INFO[1], INFO[2], 120],
        lineWidthMinPixels: 1,
        pickable: true,
      }),
      // TC/ECHO whale zones — violet dashed-look outline, no fill
      new GeoJsonLayer<EchoZoneProps>({
        id: 'closures-echo',
        data: ECHO_ZONES_2026,
        filled: false,
        stroked: true,
        getLineColor: [167, 139, 250, 150],
        lineWidthMinPixels: 1.5,
        pickable: true,
      }),
    ];
  },
};
