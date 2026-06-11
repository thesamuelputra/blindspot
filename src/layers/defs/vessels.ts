import { IconLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import type { LayerDef, LayerCtx } from '../types';
import { type SnapshotMover, MOVER_ATLAS, MOVER_MAPPING } from './aircraft';
import { useAnimatedSnapshot } from '@/map/useAnimatedSnapshot';
import { buildMoverLabels, VESSEL_CAT_COLOR } from '../moverText';

// Live AIS vessels (worker-fed, positions:vessel snapshot). Marker identity:
// chevrons color-keyed by AIS ship-type group (cargo amber, tanker red,
// passenger green, tug cyan, fishing violet), vessel name under the marker
// once zoomed in. Shows last-known + stale chip when the worker is down (D2).
const LABEL_MIN_ZOOM = 9.0;

export const vesselsLayer: LayerDef<SnapshotMover> = {
  id: 'vessels',
  label: 'VESSELS',
  pages: ['command', 'skies-seas'],
  cluster: 'Seas (Marine)',
  defaultOn: true,
  useData() {
    return useAnimatedSnapshot('positions:vessel');
  },
  toLayers(data, ctx?: LayerCtx) {
    const layers: Layer[] = [
      new IconLayer<SnapshotMover>({
        id: 'vessels',
        data,
        iconAtlas: MOVER_ATLAS,
        iconMapping: MOVER_MAPPING,
        getIcon: () => 'chevron',
        getPosition: (d) => [d.lng, d.lat],
        getAngle: (d) => -(d.h ?? 0),
        getColor: (d) => VESSEL_CAT_COLOR[d.c ?? 'vessel'] ?? VESSEL_CAT_COLOR.vessel,
        getSize: 13,
        sizeUnits: 'pixels',
        pickable: true,
      }),
    ];
    if ((ctx?.zoom ?? 0) >= LABEL_MIN_ZOOM) {
      layers.push(
        ...buildMoverLabels('vessel-labels', data, {
          getText: (d) => d.label,
          getColor: (d) => VESSEL_CAT_COLOR[d.c ?? 'vessel'] ?? VESSEL_CAT_COLOR.vessel,
          size: 9,
          offsetY: 11,
        }),
      );
    }
    return layers;
  },
};
