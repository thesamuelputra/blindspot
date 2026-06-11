import { useQuery } from 'convex/react';
import { ScatterplotLayer } from '@deck.gl/layers';
import { api } from '../../../convex/_generated/api';
import type { Doc } from '../../../convex/_generated/dataModel';
import { SEVERITY_RGBA, type LayerDef } from '../types';

const WINDOW_MS = 7 * 24 * 3600 * 1000; // 7 days of Cascadia seismicity

type Quake = Doc<'signals'>;

function mag(q: Quake): number {
  try {
    return (JSON.parse(q.raw ?? '{}') as { mag?: number }).mag ?? 1;
  } catch {
    return 1;
  }
}

export const quakesLayer: LayerDef<Quake> = {
  id: 'quakes',
  label: 'SEISMIC',
  pages: ['command', 'hazard'],
  cluster: 'Seismic & Tsunami',
  defaultOn: true,
  useData() {
    const data = useQuery(api.signals.byKind, { kind: 'earthquake', sinceMs: WINDOW_MS });
    return { data: data ?? [], updatedAt: data?.[0]?.observedAt };
  },
  toLayers(data) {
    return [
      new ScatterplotLayer<Quake>({
        id: 'quakes',
        data,
        getPosition: (d) => [d.lng ?? 0, d.lat ?? 0],
        // magnitude is log-energy: radius grows steeply so a M5 reads at a glance
        getRadius: (d) => 600 * Math.pow(2, mag(d)),
        radiusUnits: 'meters',
        radiusMinPixels: 2,
        radiusMaxPixels: 40,
        getFillColor: (d) => {
          const c = SEVERITY_RGBA[d.severity] ?? SEVERITY_RGBA.info;
          // fade with age across the window
          const age = (Date.now() - d.observedAt) / WINDOW_MS;
          return [c[0], c[1], c[2], Math.max(60, c[3] * (1 - age * 0.7))];
        },
        stroked: true,
        getLineColor: [230, 234, 240, 40],
        lineWidthMinPixels: 0.5,
        pickable: true,
      }),
    ];
  },
};
