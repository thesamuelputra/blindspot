import { useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import { useSnapshot } from '@/layers/defs/aircraft';
import { useMediaQuery } from '@/lib/useMediaQuery';

function Tile({
  label,
  value,
  tone,
  compact,
}: {
  label: string;
  value: string | number;
  tone?: string;
  compact?: boolean;
}) {
  return (
    <div
      style={{
        background: 'rgba(13,17,23,0.92)',
        border: '1px solid var(--border-hairline)',
        padding: compact ? '3px 8px' : '6px 12px',
        minWidth: compact ? 56 : 76,
      }}
    >
      <div
        className="mono"
        style={{ fontSize: compact ? 13 : 17, fontWeight: 700, color: tone ?? 'var(--text-1)' }}
      >
        {value}
      </div>
      <div className="microlabel" style={compact ? { fontSize: 8 } : undefined}>
        {label}
      </div>
    </div>
  );
}

export function StatTiles() {
  const aircraft = useSnapshot('positions:aircraft').data.length;
  const vessels = useSnapshot('positions:vessel').data.length;
  const ferries = useSnapshot('positions:ferry').data.length;
  const buses = useSnapshot('positions:bus').data.length;
  const alerts = useQuery(api.alerts.active, {}) ?? [];
  // Below 880px collapse to one compact right-aligned row under the top bar.
  // left: 214 clears the layer rail (12px inset + 190px rail + 12px gutter)
  // so the tiles never sit on top of it; they wrap if width runs out.
  const compact = useMediaQuery('(max-width: 879px)');

  return (
    <div
      style={
        compact
          ? {
              position: 'absolute',
              top: 12,
              left: 214,
              right: 12,
              zIndex: 10,
              display: 'flex',
              gap: 4,
              justifyContent: 'flex-end',
              alignContent: 'flex-start',
              flexWrap: 'wrap',
              pointerEvents: 'none',
            }
          : { position: 'absolute', top: 12, right: 12, zIndex: 10, display: 'flex', gap: 8 }
      }
    >
      <Tile label="AIRCRAFT" value={aircraft} tone="var(--accent-live)" compact={compact} />
      <Tile label="VESSELS" value={vessels + ferries} tone="var(--intel)" compact={compact} />
      <Tile label="TRANSIT" value={buses} tone="var(--ok)" compact={compact} />
      <Tile
        label="ALERTS"
        value={alerts.length}
        tone={alerts.length > 0 ? 'var(--warn)' : 'var(--text-3)'}
        compact={compact}
      />
    </div>
  );
}
