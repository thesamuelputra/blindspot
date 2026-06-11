import { useQuery } from 'convex/react';
import { ScatterplotLayer } from '@deck.gl/layers';
import { api } from '../../../convex/_generated/api';
import type { Doc } from '../../../convex/_generated/dataModel';
import { SEVERITY_RGBA, type LayerDef } from '../types';

// bchydro-outages refreshes observedAt from upstream lastUpdated every 5-min
// sync; 24h window keeps active outages on the board while resolved ones
// (which simply vanish from the upstream feed) age off within a day. No
// expiresAt filter — ETRs are estimates that routinely slip.
const WINDOW_MS = 24 * 3600 * 1000;

type Outage = Doc<'signals'>;

// raw stored by convex/feeds/bchydroOutages.ts: { customersAffected, cause, crewStatus }
function customers(o: Outage): number {
  try {
    return (
      (JSON.parse(o.raw ?? '{}') as { customersAffected?: number }).customersAffected ?? 1
    );
  } catch {
    return 1;
  }
}

export const outagesLayer: LayerDef<Outage> = {
  id: 'outages',
  label: 'OUTAGES',
  pages: ['command', 'ground', 'infrastructure'],
  cluster: 'Ground (Mobility)',
  defaultOn: true,
  useData() {
    const data = useQuery(api.signals.byKind, { kind: 'outage', sinceMs: WINDOW_MS });
    return { data: data ?? [], updatedAt: data?.[0]?.observedAt };
  },
  toLayers(data) {
    return [
      new ScatterplotLayer<Outage>({
        id: 'outages',
        data,
        getPosition: (d) => [d.lng ?? 0, d.lat ?? 0],
        // customers out is a count → sqrt scale keeps marker area ∝ impact
        getRadius: (d) => 250 * Math.sqrt(Math.max(customers(d), 1)),
        radiusUnits: 'meters',
        radiusMinPixels: 3,
        radiusMaxPixels: 30,
        // uniformly amber — this feed maxes at 'warning' (amber, full) and the
        // info tier borrows watch-amber so small outages still read as outages
        getFillColor: (d) =>
          d.severity === 'warning' ? SEVERITY_RGBA.warning : SEVERITY_RGBA.watch,
        stroked: true,
        getLineColor: [230, 234, 240, 60],
        lineWidthMinPixels: 0.5,
        pickable: true,
      }),
    ];
  },
};
