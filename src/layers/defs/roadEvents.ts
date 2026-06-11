import { useQuery } from 'convex/react';
import { ScatterplotLayer } from '@deck.gl/layers';
import { api } from '../../../convex/_generated/api';
import type { Doc } from '../../../convex/_generated/dataModel';
import { SEVERITY_RGBA, type LayerDef } from '../types';

// drivebc-open511 refreshes observedAt every 300s sync; a 24h window keeps
// last-known events on the board through a feed outage while events DriveBC
// resolves (dropped from its ACTIVE feed) age out within a day.
const WINDOW_MS = 24 * 3600 * 1000;

type RoadEvent = Doc<'signals'>;

export const roadEventsLayer: LayerDef<RoadEvent> = {
  id: 'road-events',
  label: 'ROADS',
  pages: ['command', 'ground'],
  cluster: 'Ground (Mobility)',
  defaultOn: true,
  useData() {
    const data = useQuery(api.signals.byKind, { kind: 'road-event', sinceMs: WINDOW_MS });
    return { data: data ?? [], updatedAt: data?.[0]?.observedAt };
  },
  toLayers(data) {
    const points = data.filter((d) => d.lat != null && d.lng != null);
    return [
      new ScatterplotLayer<RoadEvent>({
        id: 'road-events',
        data: points,
        getPosition: (d) => [d.lng ?? 0, d.lat ?? 0],
        getRadius: 400,
        radiusUnits: 'meters',
        radiusMinPixels: 3,
        radiusMaxPixels: 24,
        // severity ← upstream Open511 `severity` (MAJOR → warning, else info)
        getFillColor: (d) => SEVERITY_RGBA[d.severity] ?? SEVERITY_RGBA.info,
        stroked: true,
        getLineColor: [230, 234, 240, 60],
        lineWidthMinPixels: 0.5,
        pickable: true,
      }),
    ];
  },
};
