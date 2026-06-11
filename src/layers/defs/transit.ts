import { ScatterplotLayer } from '@deck.gl/layers';
import type { LayerDef } from '../types';
import { type SnapshotMover } from './aircraft';
import { useAnimatedSnapshot } from '@/map/useAnimatedSnapshot';

// BC Transit buses (Victoria Regional) from the positions:bus snapshot —
// never raw entity scans (ARCHITECTURE §10). Dense fleet (~200+ at peak),
// so defaultOn false and small emerald dots. Tooltips arrive in Phase 5.
export const transitLayer: LayerDef<SnapshotMover> = {
  id: 'transit',
  label: 'TRANSIT',
  pages: ['command', 'ground'],
  cluster: 'Ground (Mobility)',
  defaultOn: false,
  useData() {
    return useAnimatedSnapshot('positions:bus');
  },
  toLayers(data) {
    return [
      new ScatterplotLayer<SnapshotMover>({
        id: 'transit',
        data,
        getPosition: (d) => [d.lng, d.lat],
        getFillColor: [52, 211, 153, 200],
        radiusMinPixels: 2.5,
        radiusMaxPixels: 6,
        pickable: true,
      }),
    ];
  },
};
