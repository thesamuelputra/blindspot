import { IconLayer } from '@deck.gl/layers';
import type { LayerDef } from '../types';
import { type SnapshotMover } from './aircraft';
import { useAnimatedSnapshot } from '@/map/useAnimatedSnapshot';

// Live AIS vessels (worker-fed, positions:vessel snapshot). Light chevrons —
// shows last-known + stale chip when the worker is down (graceful, D2).
export const vesselsLayer: LayerDef<SnapshotMover> = {
  id: 'vessels',
  label: 'VESSELS',
  pages: ['command', 'skies-seas'],
  cluster: 'Seas (Marine)',
  defaultOn: true,
  useData() {
    return useAnimatedSnapshot('positions:vessel');
  },
  toLayers(data) {
    return [
      new IconLayer<SnapshotMover>({
        id: 'vessels',
        data,
        iconAtlas: '/icons/chevron.png',
        iconMapping: { mover: { x: 0, y: 0, width: 64, height: 64, mask: true } },
        getIcon: () => 'mover',
        getPosition: (d) => [d.lng, d.lat],
        getAngle: (d) => -(d.h ?? 0),
        getColor: [230, 234, 240, 220],
        getSize: 13,
        sizeUnits: 'pixels',
        pickable: true,
      }),
    ];
  },
};
