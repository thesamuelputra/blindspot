import { useQuery } from 'convex/react';
import { ScatterplotLayer } from '@deck.gl/layers';
import { api } from '../../../convex/_generated/api';
import type { Doc } from '../../../convex/_generated/dataModel';
import type { LayerDef } from '../types';

const WINDOW_MS = 14 * 24 * 3600 * 1000; // match the feed's 14-day catalog window

// Slow-slip tremor, not earthquakes: an ETS swarm should read as a faint
// violet cloud under the island, not confetti — hence low alpha + tiny radii.
// Violet is deliberate (spec): tremor is its own phenomenon, never
// severity-graded above 'info', so SEVERITY_RGBA grey would bury it.
const TREMOR_VIOLET: [number, number, number, number] = [167, 139, 250, 120];

type Tremor = Doc<'signals'>;

export const tremorLayer: LayerDef<Tremor> = {
  id: 'tremor',
  label: 'TREMOR',
  pages: ['command', 'hazard'],
  cluster: 'Seismic & Tsunami',
  defaultOn: true,
  useData() {
    const data = useQuery(api.signals.byKind, { kind: 'tremor', sinceMs: WINDOW_MS, limit: 1000 });
    return { data: data ?? [], updatedAt: data?.[0]?.observedAt };
  },
  toLayers(data) {
    return [
      new ScatterplotLayer<Tremor>({
        id: 'tremor',
        data,
        getPosition: (d) => [d.lng ?? 0, d.lat ?? 0],
        // fixed small footprint — tremor "magnitude" carries no size meaning here
        getRadius: 500,
        radiusUnits: 'meters',
        radiusMinPixels: 1.5,
        radiusMaxPixels: 4,
        getFillColor: TREMOR_VIOLET,
        stroked: false,
        pickable: true,
      }),
    ];
  },
};
