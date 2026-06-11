import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { ScatterplotLayer } from '@deck.gl/layers';
import { useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import type { Doc } from '../../convex/_generated/dataModel';
import { SEVERITY_RGBA } from '@/layers/types';
import { useUi } from '@/state/ui';

const STYLE_URL = '/basemap/blindspot-dark.json';
const WEEK = 7 * 24 * 3600_000;

// WORLD — the global threat board on a globe (BRIEF §4 page 12, §8.9).
// Same fusion-fed signal store, world-event + launch kinds, globe projection.
export function WorldPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const setInspect = useUi((s) => s.setInspect);

  const worldEvents = useQuery(api.signals.byKind, { kind: 'world-event', sinceMs: WEEK }) ?? [];
  const launches = useQuery(api.signals.byKind, { kind: 'launch', sinceMs: WEEK }) ?? [];

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const map = new maplibregl.Map({
      container,
      style: STYLE_URL,
      center: [-140, 35],
      zoom: 1.6,
      attributionControl: { compact: true },
    });
    map.on('style.load', () => {
      map.setProjection({ type: 'globe' });
    });
    const overlay = new MapboxOverlay({ interleaved: false, layers: [] });
    map.addControl(overlay);
    overlayRef.current = overlay;
    return () => {
      overlayRef.current = null;
      map.remove();
    };
  }, []);

  useEffect(() => {
    const geo = (s: Doc<'signals'>) => s.lat != null && s.lng != null;
    overlayRef.current?.setProps({
      layers: [
        new ScatterplotLayer<Doc<'signals'>>({
          id: 'world-events',
          data: worldEvents.filter(geo),
          getPosition: (d) => [d.lng!, d.lat!],
          getRadius: 90_000,
          radiusMinPixels: 3,
          radiusMaxPixels: 10,
          getFillColor: (d) => SEVERITY_RGBA[d.severity] ?? SEVERITY_RGBA.info,
          pickable: true,
        }),
        new ScatterplotLayer<Doc<'signals'>>({
          id: 'world-launches',
          data: launches.filter(geo),
          getPosition: (d) => [d.lng!, d.lat!],
          getRadius: 70_000,
          radiusMinPixels: 3,
          radiusMaxPixels: 8,
          getFillColor: [56, 189, 248, 220],
          pickable: true,
        }),
      ],
      onClick: (info: { object?: unknown }) => {
        if (info.object) setInspect({ type: 'signal', data: info.object as Record<string, unknown> });
      },
      getCursor: ({ isHovering }: { isHovering: boolean }) => (isHovering ? 'pointer' : ''),
    });
  }, [worldEvents, launches, setInspect]);

  const counts = {
    events: worldEvents.length,
    launches: launches.length,
    critical: worldEvents.filter((s) => s.severity === 'critical' || s.severity === 'warning').length,
  };

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
      <div
        style={{
          position: 'absolute',
          top: 12,
          left: 12,
          zIndex: 10,
          background: 'rgba(13,17,23,0.92)',
          border: '1px solid var(--border-hairline)',
          padding: '8px 12px',
        }}
      >
        <div className="microlabel">WORLD MODE · LAST 7 DAYS</div>
        <div className="mono" style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 4 }}>
          {counts.events} events · {counts.launches} launches ·{' '}
          <span style={{ color: counts.critical > 0 ? 'var(--warn)' : 'var(--text-3)' }}>
            {counts.critical} elevated
          </span>
        </div>
        <div className="microlabel" style={{ marginTop: 4 }}>
          GDACS · WHO · GAC · GDELT · LL2
        </div>
      </div>
    </div>
  );
}
