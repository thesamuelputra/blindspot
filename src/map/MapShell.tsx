import { useEffect, useRef, useState, type ReactNode } from 'react';
import maplibregl from 'maplibre-gl';
import { MapboxOverlay } from '@deck.gl/mapbox';
import type { Layer, PickingInfo } from '@deck.gl/core';
import 'maplibre-gl/dist/maplibre-gl.css';
import { VI_BBOX } from '@/lib/bbox';
import { useUi } from '@/state/ui';
import type { RasterSpec } from '@/layers/types';

// Forked + desaturated OpenFreeMap dark style (scripts/fetch-basemap.mjs).
// Falls back to the hosted style if the fork hasn't been generated.
const STYLE_URL = '/basemap/blindspot-dark.json';
const STYLE_FALLBACK = 'https://tiles.openfreemap.org/styles/dark';

export interface RasterToggle {
  id: string;
  spec: RasterSpec;
  on: boolean;
}

export function MapShell({
  layers = [],
  rasters = [],
  onPickHover,
  onPickClick,
  children,
}: {
  layers?: Layer[];
  rasters?: RasterToggle[];
  onPickHover?: (info: PickingInfo) => void;
  onPickClick?: (info: PickingInfo) => void;
  children?: ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const [map, setMap] = useState<maplibregl.Map | null>(null);
  const setReticle = useUi((s) => s.setReticle);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    let m: maplibregl.Map | null = null;

    void (async () => {
      const style = await fetch(STYLE_URL, { method: 'HEAD' })
        .then((r) => (r.ok ? STYLE_URL : STYLE_FALLBACK))
        .catch(() => STYLE_FALLBACK);
      if (cancelled) return;

      m = new maplibregl.Map({
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
      const overlay = new MapboxOverlay({ interleaved: true, layers: [] });
      m.addControl(overlay);
      overlayRef.current = overlay;

      m.on('mousemove', (e) => setReticle({ lat: e.lngLat.lat, lng: e.lngLat.lng }));
      m.on('mouseout', () => setReticle(null));
      m.on('load', () => {
        if (!cancelled) setMap(m);
      });

      if (import.meta.env.DEV) {
        (window as unknown as { __map?: maplibregl.Map }).__map = m;
      }
    })();

    return () => {
      cancelled = true;
      setReticle(null);
      overlayRef.current = null;
      setMap(null);
      m?.remove();
    };
  }, [setReticle]);

  useEffect(() => {
    overlayRef.current?.setProps({
      layers,
      onHover: onPickHover,
      onClick: onPickClick,
      getCursor: ({ isHovering }: { isHovering: boolean }) => (isHovering ? 'pointer' : ''),
    });
  }, [layers, onPickHover, onPickClick]);

  // one-shot fly-to requests (analyst highlights, ⌘K, incidents)
  const flyTo = useUi((s) => s.flyTo);
  const requestFlyTo = useUi((s) => s.requestFlyTo);
  useEffect(() => {
    if (!map || !flyTo) return;
    map.flyTo({ center: [flyTo.lng, flyTo.lat], zoom: flyTo.zoom ?? 10, duration: 1200 });
    requestFlyTo(null);
  }, [map, flyTo, requestFlyTo]);

  // Raster overlays: sync sources/layers with toggles, insert below the first
  // symbol layer so place labels stay readable above radar/satellite imagery.
  useEffect(() => {
    if (!map) return;
    const timers: ReturnType<typeof setInterval>[] = [];
    const firstSymbol = map.getStyle().layers.find((l) => l.type === 'symbol')?.id;

    for (const r of rasters) {
      const srcId = `raster:${r.id}`;
      const exists = map.getLayer(srcId) !== undefined;
      if (r.on && !exists) {
        const bust = `&_t=${Math.floor(Date.now() / 60000)}`;
        map.addSource(srcId, {
          type: 'raster',
          tiles: r.spec.tiles.map((t) => t + bust),
          tileSize: r.spec.tileSize ?? 256,
          attribution: r.spec.attribution,
        });
        map.addLayer(
          {
            id: srcId,
            type: 'raster',
            source: srcId,
            paint: { 'raster-opacity': r.spec.opacity ?? 0.7, 'raster-fade-duration': 300 },
          },
          firstSymbol,
        );
        if (r.spec.refreshSec) {
          timers.push(
            setInterval(() => {
              const src = map.getSource(srcId) as maplibregl.RasterTileSource | undefined;
              src?.setTiles(r.spec.tiles.map((t) => t + `&_t=${Math.floor(Date.now() / 60000)}`));
            }, r.spec.refreshSec * 1000),
          );
        }
      } else if (!r.on && exists) {
        map.removeLayer(srcId);
        map.removeSource(srcId);
      }
    }

    return () => timers.forEach(clearInterval);
  }, [map, rasters]);

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
      {children}
    </div>
  );
}
