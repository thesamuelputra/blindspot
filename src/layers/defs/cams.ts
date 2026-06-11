import { useQuery } from 'convex/react';
import { IconLayer } from '@deck.gl/layers';
import { api } from '../../../convex/_generated/api';
import type { Doc } from '../../../convex/_generated/dataModel';
import type { LayerDef } from '../types';

// Camera markers wear a camera glyph (Samuel's marker-identity contract).
// Straight from cameras.list — the inventory changes rarely, no snapshot hop.
// Audio nodes (hydrophones) render violet; visual cams neutral grey.
type Camera = Doc<'cameras'>;

const CAM_GREY: [number, number, number, number] = [170, 180, 196, 215];
const AUDIO_VIOLET: [number, number, number, number] = [167, 139, 250, 225];

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
      new IconLayer<Camera>({
        id: 'cams',
        data,
        iconAtlas: '/icons/camera.png',
        iconMapping: { cam: { x: 0, y: 0, width: 64, height: 64, mask: true } },
        getIcon: () => 'cam',
        getPosition: (d) => [d.lng, d.lat],
        getColor: (d) => (d.kind === 'audio' ? AUDIO_VIOLET : CAM_GREY),
        getSize: 15,
        sizeUnits: 'pixels',
        sizeMinPixels: 11,
        pickable: true,
      }),
    ];
  },
};
