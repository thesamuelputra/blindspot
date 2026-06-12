import { useQuery } from 'convex/react';
import { IconLayer, ScatterplotLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
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
    const approx = data.filter((d) => d.approxKm && d.approxKm > 0);
    const layers: Layer[] = [];
    // uncertainty range circle for cams placed at an estimated location
    if (approx.length > 0) {
      layers.push(
        new ScatterplotLayer<Camera>({
          id: 'cams-approx',
          data: approx,
          getPosition: (d) => [d.lng, d.lat],
          getRadius: (d) => (d.approxKm ?? 0) * 1000,
          radiusUnits: 'meters',
          stroked: true,
          filled: true,
          getFillColor: [170, 180, 196, 14],
          getLineColor: [170, 180, 196, 70],
          lineWidthMinPixels: 1,
          pickable: false,
        }),
      );
    }
    layers.push(
      new IconLayer<Camera>({
        id: 'cams',
        data,
        iconAtlas: '/icons/camicons.png',
        iconMapping: {
          cctv: { x: 0, y: 0, width: 64, height: 64, mask: true },
          hydrophone: { x: 64, y: 0, width: 64, height: 64, mask: true },
        },
        // audio nodes (hydrophones) get the sound-wave glyph; eyes get the CCTV
        getIcon: (d) => (d.kind === 'audio' ? 'hydrophone' : 'cctv'),
        getPosition: (d) => [d.lng, d.lat],
        getColor: (d) => (d.kind === 'audio' ? AUDIO_VIOLET : CAM_GREY),
        getSize: 15,
        sizeUnits: 'pixels',
        sizeMinPixels: 11,
        pickable: true,
      }),
    );
    return layers;
  },
};
