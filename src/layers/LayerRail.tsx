import { useNow } from '@/lib/time';
import { useUi } from '@/state/ui';
import type { LayerDef, LayerData } from './types';

function ago(now: number, ts?: number): string {
  if (!ts) return '—';
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 90) return `${s}s`;
  if (s < 5400) return `${Math.floor(s / 60)}m`;
  if (s < 172800) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function RailRow({ def, data }: { def: LayerDef; data: LayerData }) {
  const now = useNow(5000);
  const on = useUi((s) => s.layersOn[def.id] ?? def.defaultOn);
  const toggle = useUi((s) => s.toggleLayer);
  return (
    <button
      onClick={() => toggle(def.id, def.defaultOn)}
      className="mono"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: '100%',
        padding: '5px 10px',
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        color: on ? 'var(--text-1)' : 'var(--text-3)',
        fontSize: 10,
        letterSpacing: '0.1em',
      }}
    >
      <span
        className="dot"
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: on ? 'var(--accent-live)' : 'var(--text-3)',
          flexShrink: 0,
        }}
      />
      <span style={{ flex: 1, textAlign: 'left' }}>{def.label}</span>
      <span style={{ color: 'var(--text-3)' }}>{def.raster ? 'IMG' : data.data.length}</span>
      <span style={{ color: 'var(--text-3)', width: 28, textAlign: 'right' }}>
        {def.raster ? 'live' : ago(now, data.updatedAt)}
      </span>
    </button>
  );
}

export function LayerRail({
  defs,
  dataById,
}: {
  defs: LayerDef[];
  dataById: Record<string, LayerData>;
}) {
  if (defs.length === 0) return null;
  return (
    <div
      className="scanlines"
      style={{
        position: 'absolute',
        top: 12,
        left: 12,
        zIndex: 10,
        width: 190,
        background: 'rgba(13,17,23,0.92)',
        border: '1px solid var(--border-hairline)',
        backdropFilter: 'blur(4px)',
      }}
    >
      <div className="microlabel" style={{ padding: '7px 10px 3px' }}>
        LAYERS
      </div>
      {defs.map((d) => (
        <RailRow key={d.id} def={d} data={dataById[d.id] ?? { data: [] }} />
      ))}
    </div>
  );
}
