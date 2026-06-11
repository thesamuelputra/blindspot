import { ScatterplotLayer } from '@deck.gl/layers';
import type { LayerDef } from '../types';
import { useSnapshot } from './aircraft';

// EV charging POIs from the stations:open-charge-map snapshot (compact JSON
// written by convex/feeds/openChargeMap.ts — never raw table scans,
// ARCHITECTURE §10). Slow-changing registry, not live availability; value is
// the port count. Soft emerald dots, off by default. Attribution note: OCM
// imported records require per-record DataProvider attribution wherever
// individual records are surfaced (tooltips, Phase 5).
export interface EvCharger {
  id: string;
  label: string;
  lat: number;
  lng: number;
  value: number; // port count
  unit: string; // 'ports'
  at: number;
}

const DOT: [number, number, number, number] = [52, 211, 153, 140];

export const evChargersLayer: LayerDef<EvCharger> = {
  id: 'ev-chargers',
  label: 'EV',
  pages: ['infrastructure'],
  cluster: 'Infrastructure / Network / Cyber',
  defaultOn: false,
  useData() {
    const { data, updatedAt } = useSnapshot('stations:open-charge-map');
    return { data: data as unknown as EvCharger[], updatedAt };
  },
  toLayers(data) {
    return [
      new ScatterplotLayer<EvCharger>({
        id: 'ev-chargers',
        data,
        getPosition: (d) => [d.lng, d.lat],
        getFillColor: DOT,
        radiusMinPixels: 2,
        radiusMaxPixels: 6,
        pickable: true,
      }),
    ];
  },
};
