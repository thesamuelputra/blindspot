import { ScatterplotLayer } from '@deck.gl/layers';
import type { LayerDef } from '../types';
import { useSnapshot } from './aircraft';

// PM2.5 community sensors from the stations:purpleair snapshot (written by
// convex/feeds/purpleair.ts — keyed source, so the layer stays empty until
// PURPLEAIR_KEY lands). Dots banded on the spec thresholds, which track the
// 24h PM2.5 guidance bands: ≤12 µg/m³ green, ≤35 amber, >35 red. defaultOn
// false — community-instrument data (confidence 0.8) earns its place on the
// rail, not on first paint. No tooltips yet (Phase 5).
export interface Pm25Station {
  id: string; // PurpleAir sensor_index
  label: string;
  lat: number;
  lng: number;
  value: number; // pm2.5_10minute, µg/m³
  unit: string;
  at: number; // data_time_stamp, epoch ms
}

const GOOD: [number, number, number, number] = [52, 211, 153, 180];
const MODERATE: [number, number, number, number] = [245, 158, 11, 200];
const HIGH: [number, number, number, number] = [239, 68, 68, 220];

function bandColor(value: number): [number, number, number, number] {
  return value > 35 ? HIGH : value > 12 ? MODERATE : GOOD;
}

export const pm25Layer: LayerDef<Pm25Station> = {
  id: 'pm25',
  label: 'PM2.5',
  pages: ['command', 'environment'],
  cluster: 'Environment & Conditions',
  defaultOn: false,
  useData() {
    const { data, updatedAt } = useSnapshot('stations:purpleair');
    const stations = data as unknown as Pm25Station[];
    // every row shares the poll's data_time_stamp — advertise it, not write time
    const newest = stations.reduce((max, s) => Math.max(max, s.at ?? 0), 0);
    return { data: stations, updatedAt: newest || updatedAt };
  },
  toLayers(data) {
    return [
      new ScatterplotLayer<Pm25Station>({
        id: 'pm25',
        data,
        getPosition: (d) => [d.lng, d.lat],
        // up to 150 sensors clustered in towns: smaller footprint than the
        // five-community AQHI dots; color carries the value, not size
        getRadius: 500,
        radiusUnits: 'meters',
        radiusMinPixels: 2,
        radiusMaxPixels: 6,
        getFillColor: (d) => bandColor(d.value),
        stroked: false,
        pickable: true,
      }),
    ];
  },
};
