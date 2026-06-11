import { ScatterplotLayer } from '@deck.gl/layers';
import type { LayerDef } from '../types';
import { useSnapshot } from './aircraft';

// Marine buoy stations from the stations:noaa-ndbc-buoys snapshot (compact
// JSON written by convex/feeds/ndbcBuoys.ts — never raw readings scans,
// ARCHITECTURE §10). Small accent-live dots; tooltips arrive in Phase 5.
export interface BuoyStation {
  id: string;
  label: string;
  lat: number;
  lng: number;
  value: number | null; // headline: wave_height (m), fallback wind_speed (m/s)
  unit: string;
  at: number;
}

const DOT: [number, number, number, number] = [56, 189, 248, 200];

export const buoysLayer: LayerDef<BuoyStation> = {
  id: 'buoys',
  label: 'BUOYS',
  pages: ['command', 'skies-seas', 'environment'],
  cluster: 'Seas (Marine)',
  defaultOn: true,
  useData() {
    const { data, updatedAt } = useSnapshot('stations:noaa-ndbc-buoys');
    return { data: data as unknown as BuoyStation[], updatedAt };
  },
  toLayers(data) {
    return [
      new ScatterplotLayer<BuoyStation>({
        id: 'buoys',
        data,
        getPosition: (d) => [d.lng, d.lat],
        getRadius: 400,
        radiusUnits: 'meters',
        radiusMinPixels: 3,
        radiusMaxPixels: 8,
        getFillColor: DOT,
        stroked: false,
        pickable: true,
      }),
    ];
  },
};
