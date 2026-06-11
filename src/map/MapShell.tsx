import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import { MapboxOverlay } from '@deck.gl/mapbox';
import 'maplibre-gl/dist/maplibre-gl.css';
import { VI_BBOX } from '@/lib/bbox';
import { useUi } from '@/state/ui';

// Forked + desaturated OpenFreeMap dark style (scripts/fetch-basemap.mjs).
// Falls back to the hosted style if the fork hasn't been generated.
const STYLE_URL = '/basemap/blindspot-dark.json';
const STYLE_FALLBACK = 'https://tiles.openfreemap.org/styles/dark';

export function MapShell() {
  const containerRef = useRef<HTMLDivElement>(null);
  const setReticle = useUi((s) => s.setReticle);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    let map: maplibregl.Map | null = null;

    void (async () => {
      // Probe the forked style; fall back to hosted if missing (dev convenience).
      const style = await fetch(STYLE_URL, { method: 'HEAD' })
        .then((r) => (r.ok ? STYLE_URL : STYLE_FALLBACK))
        .catch(() => STYLE_FALLBACK);
      if (cancelled) return;

      map = new maplibregl.Map({
        container,
        style,
        bounds: [
          [VI_BBOX.west, VI_BBOX.south],
          [VI_BBOX.east, VI_BBOX.north],
        ],
        fitBoundsOptions: { padding: 32 },
        attributionControl: { compact: true },
      });

      // deck.gl overlay — interleaved (shared WebGL2 context). Layers arrive
      // from the registry in Phase 3; the overlay is mounted now so the
      // integration is proven in the foundation.
      const overlay = new MapboxOverlay({ interleaved: true, layers: [] });
      map.addControl(overlay);

      map.on('mousemove', (e) => setReticle({ lat: e.lngLat.lat, lng: e.lngLat.lng }));
      map.on('mouseout', () => setReticle(null));
    })();

    return () => {
      cancelled = true;
      setReticle(null);
      map?.remove();
    };
  }, [setReticle]);

  return <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />;
}
