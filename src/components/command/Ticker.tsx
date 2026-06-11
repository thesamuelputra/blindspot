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

interface Signal {
  _id: string;
  title: string;
  severity: string;
  observedAt: number;
  lat?: number;
  lng?: number;
}

function Item({ s, now }: { s: Signal; now: number }) {
  const setInspect = useUi((st) => st.setInspect);
  const requestFlyTo = useUi((st) => st.requestFlyTo);
  return (
    <button
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
        display: 'inline-flex',
        gap: 6,
        alignItems: 'center',
        padding: 0,
      }}
    >
      <span
        className="dot"
        style={{ width: 5, height: 5, borderRadius: '50%', background: SEV_COLOR[s.severity], flexShrink: 0 }}
      />
      {s.title.slice(0, 90)}
      <span style={{ color: 'var(--text-3)' }}>{ago(now, s.observedAt)}</span>
    </button>
  );
}

// Live event ticker (BRIEF §12) — a continuously rolling marquee of the newest
// signals. Pauses on hover, items click through to the inspector. The track is
// duplicated so the loop is seamless; reduced motion falls back to a still row.
export function Ticker() {
  const signals = (useQuery(api.signals.recent, { limit: 25 }) ?? []) as Signal[];
  const now = useNow(5000);
  if (signals.length === 0) return null;

  return (
    <div
      className="ticker-viewport"
      style={{
        position: 'absolute',
        left: 12,
        right: 12,
        bottom: 12,
        zIndex: 10,
        height: 30,
        background: 'rgba(13,17,23,0.92)',
        border: '1px solid var(--border-hairline)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        overflow: 'hidden',
      }}
    >
      <span
        className="microlabel"
        style={{
          padding: '0 10px',
          borderRight: '1px solid var(--border-hairline)',
          flexShrink: 0,
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          background: 'rgba(13,17,23,0.96)',
          zIndex: 1,
        }}
      >
        LIVE FEED
      </span>
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        <div className="ticker-track" style={{ paddingLeft: 24 }}>
          {/* duplicated for a seamless -50% loop */}
          {[...signals, ...signals].map((s, i) => (
            <Item key={`${s._id}-${i}`} s={s} now={now} />
          ))}
        </div>
      </div>
    </div>
  );
}
