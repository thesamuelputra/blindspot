import { ScatterplotLayer } from '@deck.gl/layers';
import type { LayerDef } from '../types';
import { useSnapshot } from './aircraft';

// Tide stations from the stations:dfo-chs-tides snapshot — current observed
// water level (metres above chart datum) per CHS station. Small dots only;
// tooltips/curves land in Phase 5.
export interface TideStation {
  id: string; // 5-digit CHS code, e.g. "07120"
  label: string;
  lat: number;
  lng: number;
  value: number; // metres above chart datum
  unit: string; // 'm'
  at: number;
}

const DOT: [number, number, number, number] = [56, 189, 248, 180];

export const tideStationsLayer: LayerDef<TideStation> = {
  id: 'tides',
  label: 'TIDES',
  pages: ['command', 'skies-seas', 'environment'],
  cluster: 'Seas (Marine)',
  defaultOn: false,
  useData() {
    const { data, updatedAt } = useSnapshot('stations:dfo-chs-tides');
    return { data: data as unknown as TideStation[], updatedAt };
  },
  toLayers(data) {
    return [
      new ScatterplotLayer<TideStation>({
        id: 'tides',
        data,
        getPosition: (d) => [d.lng, d.lat],
        getFillColor: DOT,
        radiusMinPixels: 3,
        radiusMaxPixels: 6,
        pickable: true,
      }),
    ];
  },
};
