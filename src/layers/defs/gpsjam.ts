import { useQuery } from 'convex/react';
import { GeoJsonLayer } from '@deck.gl/layers';
import type { Feature, Polygon } from 'geojson';
import { api } from '../../../convex/_generated/api';
import type { Doc } from '../../../convex/_generated/dataModel';
import { SEVERITY_RGBA, type LayerDef } from '../types';

// GPSJAM H3 interference cells (gpsjam feed). Daily aggregate with ~1-day
// lag — situational awareness, not alerting. Attribution: GPSJAM / John
// Wiseman · data: ADS-B Exchange.

type Jam = Doc<'signals'>;

interface JamProps {
  severity: Jam['severity'];
  title: string;
}

// observedAt is the data-file's UTC midnight (1–2 days back), so the query
// window must reach past the 48h expiresAt; expiry itself is honored below.
const WINDOW_MS = 72 * 3600 * 1000;

// Signals with unparseable geojson are skipped — they still surface in feeds.
function toFeatures(rows: Jam[]): Feature<Polygon, JamProps>[] {
  const features: Feature<Polygon, JamProps>[] = [];
  for (const r of rows) {
    if (!r.geojson) continue;
    try {
      features.push({
        type: 'Feature',
        geometry: JSON.parse(r.geojson) as Polygon,
        properties: { severity: r.severity, title: r.title },
      });
    } catch {
      // malformed cell polygon: skip
    }
  }
  return features;
}

export const gpsjamLayer: LayerDef<Jam> = {
  id: 'gpsjam',
  label: 'GPS JAM',
  pages: ['command', 'signals'],
  cluster: 'RF / Signals',
  defaultOn: false,
  useData() {
    const data = useQuery(api.signals.byKind, { kind: 'anomaly', sinceMs: WINDOW_MS });
    // kind "anomaly" is shared (brain-derived anomalies land there too) —
    // keep only gpsjam cells, and drop rows past their 48h expiry.
    const now = Date.now();
    const rows = (data ?? []).filter(
      (d) => d.sourceSlug === 'gpsjam' && (d.expiresAt ?? Infinity) > now,
    );
    return { data: rows, updatedAt: rows[0]?.observedAt };
  },
  toLayers(data) {
    return [
      new GeoJsonLayer<JamProps>({
        id: 'gpsjam',
        data: toFeatures(data),
        filled: true,
        // translucent severity fill (60 alpha) so the basemap stays readable
        getFillColor: (f) => {
          const c = SEVERITY_RGBA[f.properties.severity] ?? SEVERITY_RGBA.info;
          return [c[0], c[1], c[2], 60];
        },
        stroked: true,
        getLineColor: (f) => SEVERITY_RGBA[f.properties.severity] ?? SEVERITY_RGBA.info,
        lineWidthMinPixels: 1,
        pickable: true,
      }),
    ];
  },
};
