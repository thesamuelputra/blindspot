import { useQuery } from 'convex/react';
import { GeoJsonLayer } from '@deck.gl/layers';
import type { Feature, Geometry } from 'geojson';
import { api } from '../../../convex/_generated/api';
import type { Doc } from '../../../convex/_generated/dataModel';
import { SEVERITY_RGBA, type LayerDef } from '../types';

type Alert = Doc<'alerts'>;

interface AlertProps {
  severity: Alert['severity'];
  headline: string;
  capId: string;
}

type AlertFeature = Feature<Geometry, AlertProps>;

// Alerts without a polygon (or with unparseable area) are skipped — they still
// surface via the banner/feed, just not as map geometry.
function toFeatures(alerts: Alert[]): AlertFeature[] {
  const features: AlertFeature[] = [];
  for (const a of alerts) {
    if (!a.area) continue;
    try {
      features.push({
        type: 'Feature',
        geometry: JSON.parse(a.area) as Geometry,
        properties: { severity: a.severity, headline: a.headline, capId: a.capId },
      });
    } catch {
      // malformed area: skip this alert
    }
  }
  return features;
}

export const alertsLayer: LayerDef<Alert> = {
  id: 'alerts',
  label: 'WX ALERTS',
  pages: ['command', 'hazard', 'environment'],
  cluster: 'Weather & Atmosphere',
  defaultOn: true,
  useData() {
    const data = useQuery(api.alerts.active, {});
    return { data: data ?? [], updatedAt: data?.[0]?.effective };
  },
  toLayers(data) {
    return [
      new GeoJsonLayer<AlertProps>({
        id: 'alerts',
        data: toFeatures(data),
        filled: true,
        // translucent severity fill so radar/terrain stay readable underneath
        getFillColor: (f) => {
          const c = SEVERITY_RGBA[f.properties.severity] ?? SEVERITY_RGBA.info;
          return [c[0], c[1], c[2], 45];
        },
        stroked: true,
        getLineColor: (f) => SEVERITY_RGBA[f.properties.severity] ?? SEVERITY_RGBA.info,
        lineWidthMinPixels: 1,
        pickable: true,
      }),
    ];
  },
};
