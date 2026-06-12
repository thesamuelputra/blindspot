import { IconLayer } from '@deck.gl/layers';
import { type SnapshotMover, MOVER_ATLAS, MOVER_MAPPING } from './aircraft';
import { useAnimatedSnapshot } from '@/map/useAnimatedSnapshot';
import { buildMoverLabels } from '../moverText';
import type { LayerDef } from '../types';

// Radiosondes from the positions:balloon snapshot (sondehub feed). Amber
// chevrons, smaller than aircraft — usually 0–2 in range, often none.
// Attribution: SondeHub (CC BY-SA 2.0).
export const sondesLayer: LayerDef<SnapshotMover> = {
  id: 'sondes',
  label: 'SONDES',
  pages: ['command', 'signals'],
  cluster: 'RF / Signals',
  defaultOn: true,
  useData() {
    return useAnimatedSnapshot('positions:balloon');
  },
  toLayers(data) {
    return [
      new IconLayer<SnapshotMover>({
        id: 'sondes',
        data,
        iconAtlas: MOVER_ATLAS,
        iconMapping: MOVER_MAPPING,
        getIcon: () => 'balloon',
        getPosition: (d) => [d.lng, d.lat],
        getColor: [245, 158, 11, 230],
        getSize: 17,
        sizeUnits: 'pixels',
        pickable: true,
      }),
      // serial + sonde type at every zoom — at most a couple in range
      ...buildMoverLabels('sonde-labels', data, {
        getText: (d) => (d.t ? `${d.label} ${d.t}` : d.label),
        getColor: () => [245, 158, 11, 235],
        size: 9,
        offsetY: 11,
      }),
    ];
  },
};
