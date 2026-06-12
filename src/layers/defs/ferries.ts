import { IconLayer } from '@deck.gl/layers';
import { type LayerDef } from '../types';
import { type SnapshotMover, MOVER_ATLAS, MOVER_MAPPING } from './aircraft';
import { useAnimatedSnapshot } from '@/map/useAnimatedSnapshot';
import { buildMoverLabels } from '../moverText';

// BC Ferries from the positions:ferry snapshot (never raw entity scans —
// ARCHITECTURE §10). Positions are schedule-derived estimates until the AIS
// worker lands (state.estimated on the entity). Violet chevrons — marine mover.
const FERRY_VIOLET: [number, number, number, number] = [167, 139, 250, 230];

export const ferriesLayer: LayerDef<SnapshotMover> = {
  id: 'ferries',
  label: 'FERRIES',
  pages: ['command', 'skies-seas'],
  cluster: 'Seas (Marine)',
  defaultOn: true,
  useData() {
    return useAnimatedSnapshot('positions:ferry');
  },
  toLayers(data) {
    return [
      new IconLayer<SnapshotMover>({
        id: 'ferries',
        data,
        iconAtlas: MOVER_ATLAS,
        iconMapping: MOVER_MAPPING,
        getIcon: () => 'boat',
        getPosition: (d) => [d.lng, d.lat],
        getColor: FERRY_VIOLET,
        getSize: 18,
        sizeUnits: 'pixels',
        pickable: true,
      }),
      // vessel names at every zoom — only ~12 ferries on the board
      ...buildMoverLabels('ferry-labels', data, {
        getText: (d) => d.label,
        getColor: () => FERRY_VIOLET,
        size: 9,
        offsetY: 11,
      }),
    ];
  },
};
