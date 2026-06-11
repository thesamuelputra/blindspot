import { useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import { useNow } from '@/lib/time';
import { useUi } from '@/state/ui';

const SEV_COLOR: Record<string, string> = {
  critical: 'var(--critical)',
  warning: 'var(--warn)',
  watch: 'var(--warn)',
  info: 'var(--text-3)',
};

function ago(now: number, ts: number): string {
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 90) return `${s}s`;
  if (s < 5400) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

// Live event ticker (BRIEF §12) — newest signals stream along the bottom.
export function Ticker() {
  const signals = useQuery(api.signals.recent, { limit: 25 }) ?? [];
  const now = useNow(5000);
  const setInspect = useUi((s) => s.setInspect);
  const requestFlyTo = useUi((s) => s.requestFlyTo);

  if (signals.length === 0) return null;
  return (
    <div
      style={{
        position: 'absolute',
        left: 12,
        right: 12,
        bottom: 12,
        zIndex: 10,
        background: 'rgba(13,17,23,0.92)',
        border: '1px solid var(--border-hairline)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        overflow: 'hidden',
        height: 30,
      }}
    >
      <span
        className="microlabel"
        style={{ padding: '0 10px', borderRight: '1px solid var(--border-hairline)', flexShrink: 0 }}
      >
        LIVE FEED
      </span>
      <div style={{ display: 'flex', gap: 24, overflowX: 'auto', padding: '0 12px', scrollbarWidth: 'none' }}>
        {signals.map((s) => (
          <button
            key={s._id}
            onClick={() => {
              setInspect({ type: 'signal', data: s as unknown as Record<string, unknown> });
              if (s.lat != null && s.lng != null) requestFlyTo({ lat: s.lat, lng: s.lng, zoom: 9 });
            }}
            className="mono"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              fontSize: 11,
              color: 'var(--text-2)',
              display: 'flex',
              gap: 6,
              alignItems: 'center',
              padding: 0,
            }}
          >
            <span className="dot" style={{ width: 5, height: 5, borderRadius: '50%', background: SEV_COLOR[s.severity], flexShrink: 0 }} />
            {s.title.slice(0, 80)}
            <span style={{ color: 'var(--text-3)' }}>{ago(now, s.observedAt)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
