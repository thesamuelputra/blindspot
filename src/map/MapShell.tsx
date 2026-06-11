import { useEffect, useRef, type ReactNode } from 'react';
import maplibregl from 'maplibre-gl';
import { MapboxOverlay } from '@deck.gl/mapbox';
import type { Layer } from '@deck.gl/core';
import 'maplibre-gl/dist/maplibre-gl.css';
import { VI_BBOX } from '@/lib/bbox';
import { useUi } from '@/state/ui';

// Forked + desaturated OpenFreeMap dark style (scripts/fetch-basemap.mjs).
// Falls back to the hosted style if the fork hasn't been generated.
const STYLE_URL = '/basemap/blindspot-dark.json';
const STYLE_FALLBACK = 'https://tiles.openfreemap.org/styles/dark';

export function MapShell({ layers = [], children }: { layers?: Layer[]; children?: ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const setReticle = useUi((s) => s.setReticle);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    let map: maplibregl.Map | null = null;

    void (async () => {
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

      // deck.gl overlay — interleaved (shared WebGL2 context, ARCHITECTURE §10)
      const overlay = new MapboxOverlay({ interleaved: true, layers });
      map.addControl(overlay);
      overlayRef.current = overlay;

      map.on('mousemove', (e) => setReticle({ lat: e.lngLat.lat, lng: e.lngLat.lng }));
      map.on('mouseout', () => setReticle(null));

      if (import.meta.env.DEV) {
        (window as unknown as { __map?: maplibregl.Map }).__map = map;
      }
    })();

    return () => {
      cancelled = true;
      setReticle(null);
      overlayRef.current = null;
      map?.remove();
    };
    // map is created once; layer updates flow through the effect below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setReticle]);

  useEffect(() => {
    overlayRef.current?.setProps({ layers });
  }, [layers]);

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
      {children}
    </div>
  );
}
