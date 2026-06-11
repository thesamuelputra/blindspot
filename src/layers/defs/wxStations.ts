import { ScatterplotLayer } from '@deck.gl/layers';
import { type LayerDef } from '../types';
import { useSnapshot } from './aircraft';

// UVic school-based weather mesh from the stations:uvic-weather-mesh snapshot
// (compact JSON written by convex/feeds/uvicMesh.ts; never raw readings
// scans). Headline value is air_temp in °C — null when the station's
// thermometer is faulted but other sensors report. Small ambient dots, no
// tooltips yet (Phase 5).
export interface WxStation {
  id: string;
  label: string;
  lat: number;
  lng: number;
  value: number | null;
  unit: string;
  at: number;
}

export const wxStationsLayer: LayerDef<WxStation> = {
  id: 'wx-stations',
  label: 'WX MESH',
  pages: ['command', 'environment'],
  cluster: 'Weather & Atmosphere',
  defaultOn: false,
  useData() {
    const { data, updatedAt } = useSnapshot('stations:uvic-weather-mesh');
    return { data: data as unknown as WxStation[], updatedAt };
  },
  toLayers(data) {
    return [
      new ScatterplotLayer<WxStation>({
        id: 'wx-stations',
        data,
        getPosition: (d) => [d.lng, d.lat],
        getFillColor: [154, 164, 178, 160],
        radiusMinPixels: 2,
        radiusMaxPixels: 6,
        pickable: true,
      }),
    ];
  },
};
