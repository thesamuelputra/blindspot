import { useQuery } from 'convex/react';
import { ScatterplotLayer } from '@deck.gl/layers';
import { api } from '../../../convex/_generated/api';
import type { Doc } from '../../../convex/_generated/dataModel';
import { SEVERITY_RGBA, type LayerDef } from '../types';

// marine-notice signals: MSC marine text warnings (area centroids, refreshed
// every 30 min while in effect) + CCG NAVWARNs (positions parsed from notice
// text; long-lived, so a wide observedAt window with an expiresAt cut).
const WINDOW_MS = 30 * 24 * 3600 * 1000;

type Notice = Doc<'signals'>;

const INFO = SEVERITY_RGBA.info;

export const marineNoticesLayer: LayerDef<Notice> = {
  id: 'marine-notices',
  label: 'NOTICES',
  pages: ['command', 'skies-seas'],
  cluster: 'Seas (Marine)',
  defaultOn: false,
  useData() {
    const data = useQuery(api.signals.byKind, { kind: 'marine-notice', sinceMs: WINDOW_MS });
    const now = Date.now();
    // only mappable, still-current notices (coordinate-less NAVWARNs surface
    // via the feed, not the map)
    const visible = (data ?? []).filter(
      (d) => d.lat !== undefined && d.lng !== undefined && (!d.expiresAt || d.expiresAt > now),
    );
    return { data: visible, updatedAt: data?.[0]?.observedAt };
  },
  toLayers(data) {
    return [
      new ScatterplotLayer<Notice>({
        id: 'marine-notices',
        data,
        getPosition: (d) => [d.lng ?? 0, d.lat ?? 0],
        getRadius: 1200,
        radiusUnits: 'meters',
        radiusMinPixels: 3,
        radiusMaxPixels: 10,
        // quiet info-grey dots — notice details live in the feed/tooltip
        getFillColor: [INFO[0], INFO[1], INFO[2], 160],
        stroked: true,
        getLineColor: [INFO[0], INFO[1], INFO[2], 220],
        lineWidthMinPixels: 1,
        pickable: true,
      }),
    ];
  },
};
