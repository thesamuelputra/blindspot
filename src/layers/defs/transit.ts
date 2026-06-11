import { ScatterplotLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import type { LayerDef, LayerCtx } from '../types';
import { type SnapshotMover } from './aircraft';
import { useAnimatedSnapshot } from '@/map/useAnimatedSnapshot';
import { buildMoverLabels, tagColor } from '../moverText';

// BC Transit buses (Victoria Regional) from the positions:bus snapshot —
// never raw entity scans (ARCHITECTURE §10). Marker identity contract:
// each bus is color-keyed by its route and shows the route code ("22A",
// "6") once zoomed in enough for tags to breathe. Dense fleet (~200+ at
// peak), so defaultOn false.
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
      new ScatterplotLayer<SnapshotMover>({
        id: 'transit',
        data,
        getPosition: (d) => [d.lng, d.lat],
        getRadius: 60,
        radiusUnits: 'meters',
        radiusMinPixels: 3.5,
        radiusMaxPixels: 8,
        getFillColor: (d) => tagColor(d.t),
        stroked: true,
        getLineColor: [10, 12, 16, 220],
        lineWidthMinPixels: 1,
        pickable: true,
      }),
    ];
    if ((ctx?.zoom ?? 0) >= LABEL_MIN_ZOOM) {
      layers.push(
        ...buildMoverLabels('transit-labels', data, {
          getText: (d) => d.t,
          getColor: (d) => tagColor(d.t),
          size: 10,
          offsetY: 10,
        }),
      );
    }
    return layers;
  },
};
