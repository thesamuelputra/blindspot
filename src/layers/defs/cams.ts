import { useQuery } from 'convex/react';
import { ScatterplotLayer } from '@deck.gl/layers';
import { api } from '../../../convex/_generated/api';
import type { Doc } from '../../../convex/_generated/dataModel';
import type { LayerDef } from '../types';

// DriveBC highway webcams — small neutral dots straight from cameras.list
// (inventory changes rarely; no snapshot hop needed). Image popovers land in
// Phase 5; for now the dots just mark where eyes exist.
type Camera = Doc<'cameras'>;

const DOT: [number, number, number, number] = [230, 234, 240, 150];

export const camsLayer: LayerDef<Camera> = {
  id: 'cams',
  label: 'CAMS',
  pages: ['command', 'ground', 'cams'],
  cluster: 'Ground (Mobility)',
  defaultOn: false,
  useData() {
    const data = useQuery(api.cameras.list, {});
    return { data: data ?? [] };
  },
  toLayers(data) {
    return [
      new ScatterplotLayer<Camera>({
        id: 'cams',
        data,
        getPosition: (d) => [d.lng, d.lat],
        getFillColor: DOT,
        radiusMinPixels: 2.5,
        radiusMaxPixels: 5,
        pickable: true,
      }),
    ];
  },
};
