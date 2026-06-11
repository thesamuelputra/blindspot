import type { ReactNode } from 'react';
import { MapView } from '@/map/MapView';

// Cluster page scaffold: the registry-scoped map plus a right-docked data
// panel (same chrome as the Inspector). MapView renders the Inspector overlay
// itself at right:12 z:20; this panel sits at right:12 z:10 so an open
// inspector covers it. Accepted for v1 (spec note).
export function PageWithMap({ page, side }: { page: string; side: ReactNode }) {
  return (
    <>
      <MapView page={page} />
      <aside
        style={{
          position: 'absolute',
          top: 12,
          right: 12,
          bottom: 12,
          width: 360,
          zIndex: 10,
          background: 'rgba(13,17,23,0.96)',
          border: '1px solid var(--border-hairline-strong)',
          backdropFilter: 'blur(6px)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 8 }}>{side}</div>
      </aside>
    </>
  );
}
