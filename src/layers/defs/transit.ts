import { IconLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import type { LayerDef, LayerCtx } from '../types';
import { type SnapshotMover, MOVER_ATLAS, MOVER_MAPPING } from './aircraft';
import { useAnimatedSnapshot } from '@/map/useAnimatedSnapshot';
import { buildMoverLabels, tagColor } from '../moverText';

// BC Transit buses (Victoria Regional) from the positions:bus snapshot —
// never raw entity scans (ARCHITECTURE §10). Marker identity contract: a bus
// icon color-keyed per route, with the route code ("22A", "6") under it once
// zoomed in. Bus glyph stays upright (a level bus reads better than a rotated
// one); heading lives in the trail, not the marker. Dense fleet → defaultOn false.
const LABEL_MIN_ZOOM = 10.2;

export const transitLayer: LayerDef<SnapshotMover> = {
  id: 'transit',
  label: 'TRANSIT',
  pages: ['command', 'ground'],
  cluster: 'Ground (Mobility)',
  defaultOn: false,
  useData() {
    return useAnimatedSnapshot('positions:bus');
  },
  toLayers(data, ctx?: LayerCtx) {
    const layers: Layer[] = [
      new IconLayer<SnapshotMover>({
        id: 'transit',
        data,
        iconAtlas: MOVER_ATLAS,
        iconMapping: MOVER_MAPPING,
        getIcon: () => 'bus',
        getPosition: (d) => [d.lng, d.lat],
        getColor: (d) => tagColor(d.t),
        getSize: 15,
        sizeUnits: 'pixels',
        sizeMinPixels: 9,
        pickable: true,
      }),
    ];
    if ((ctx?.zoom ?? 0) >= LABEL_MIN_ZOOM) {
      layers.push(
        ...buildMoverLabels('transit-labels', data, {
          getText: (d) => d.t,
          getColor: (d) => tagColor(d.t),
          size: 10,
          offsetY: 11,
        }),
      );
    }
    return layers;
  },
};
