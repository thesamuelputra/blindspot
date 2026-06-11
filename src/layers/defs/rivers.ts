import { ScatterplotLayer } from '@deck.gl/layers';
import { type LayerDef } from '../types';
import { useSnapshot } from './aircraft';

// VI river gauges from the stations:eccc-hydrometric snapshot (compact JSON
// written by convex/feeds/ecccHydrometric.ts; never raw readings scans).
// Headline value is water_level in metres. Small ambient dots, no tooltips
// yet (Phase 5).
export interface RiverStation {
  id: string;
  label: string;
  lat: number;
  lng: number;
  value: number;
  unit: string;
  at: number;
}

export const riversLayer: LayerDef<RiverStation> = {
  id: 'rivers',
  label: 'RIVERS',
  pages: ['command', 'environment'],
  cluster: 'Infrastructure / Network / Cyber',
  defaultOn: false,
  useData() {
    const { data, updatedAt } = useSnapshot('stations:eccc-hydrometric');
    return { data: data as unknown as RiverStation[], updatedAt };
  },
  toLayers(data) {
    return [
      new ScatterplotLayer<RiverStation>({
        id: 'rivers',
        data,
        getPosition: (d) => [d.lng, d.lat],
        getFillColor: [56, 189, 248, 160],
        radiusMinPixels: 2.5,
        radiusMaxPixels: 6,
        pickable: true,
      }),
    ];
  },
};
