import { useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import { useSnapshot } from '@/layers/defs/aircraft';

function Tile({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div
      style={{
        background: 'rgba(13,17,23,0.92)',
        border: '1px solid var(--border-hairline)',
        padding: '6px 12px',
        minWidth: 76,
      }}
    >
      <div className="mono" style={{ fontSize: 17, fontWeight: 700, color: tone ?? 'var(--text-1)' }}>
        {value}
      </div>
      <div className="microlabel">{label}</div>
    </div>
  );
}

export function StatTiles() {
  const aircraft = useSnapshot('positions:aircraft').data.length;
  const vessels = useSnapshot('positions:vessel').data.length;
  const ferries = useSnapshot('positions:ferry').data.length;
  const buses = useSnapshot('positions:bus').data.length;
  const alerts = useQuery(api.alerts.active, {}) ?? [];

  return (
    <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 10, display: 'flex', gap: 8 }}>
      <Tile label="AIRCRAFT" value={aircraft} tone="var(--accent-live)" />
      <Tile label="VESSELS" value={vessels + ferries} tone="var(--intel)" />
      <Tile label="TRANSIT" value={buses} tone="var(--ok)" />
      <Tile
        label="ALERTS"
        value={alerts.length}
        tone={alerts.length > 0 ? 'var(--warn)' : 'var(--text-3)'}
      />
    </div>
  );
}
