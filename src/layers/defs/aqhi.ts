import { ScatterplotLayer } from '@deck.gl/layers';
import type { LayerDef } from '../types';
import { useSnapshot } from './aircraft';

// AQHI community stations from the stations:eccc-aqhi snapshot (written by
// convex/feeds/ecccAqhi.ts). Small dots banded on the official AQHI risk
// scale: low (1-3) green, moderate (4-6) amber, high+ (7+) red. Observations
// are floats (e.g. 1.28) — round first, matching how ECCC reports the index.
// No tooltips yet (Phase 5).
export interface AqhiStation {
  id: string; // ECCC location_id, e.g. JBOBQ (Victoria / Saanich)
  label: string;
  lat: number;
  lng: number;
  value: number;
  unit: string;
  at: number; // observation_datetime, epoch ms
}

const LOW: [number, number, number, number] = [52, 211, 153, 200];
const MODERATE: [number, number, number, number] = [245, 158, 11, 210];
const HIGH: [number, number, number, number] = [239, 68, 68, 230];

function bandColor(value: number): [number, number, number, number] {
  const v = Math.round(value);
  return v >= 7 ? HIGH : v >= 4 ? MODERATE : LOW;
}

export const aqhiLayer: LayerDef<AqhiStation> = {
  id: 'aqhi',
  label: 'AQHI',
  pages: ['command', 'environment'],
  cluster: 'Environment & Conditions',
  defaultOn: true,
  useData() {
    const { data, updatedAt } = useSnapshot('stations:eccc-aqhi');
    const stations = data as unknown as AqhiStation[];
    // hourly product — advertise the newest observation time, not poll time
    const newest = stations.reduce((max, s) => Math.max(max, s.at ?? 0), 0);
    return { data: stations, updatedAt: newest || updatedAt };
  },
  toLayers(data) {
    return [
      new ScatterplotLayer<AqhiStation>({
        id: 'aqhi',
        data,
        getPosition: (d) => [d.lng, d.lat],
        // five communities island-wide: fixed small footprint, value carries
        // the meaning through color, not size
        getRadius: 1200,
        radiusUnits: 'meters',
        radiusMinPixels: 3,
        radiusMaxPixels: 8,
        getFillColor: (d) => bandColor(d.value),
        stroked: false,
        pickable: true,
      }),
    ];
  },
};
