import { useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import { useNow, formatUtc, formatLocal, formatCoord } from '@/lib/time';
import { useUi } from '@/state/ui';

const THREAT_TONE: Record<string, string> = {
  NOMINAL: 'var(--ok)',
  ELEVATED: 'var(--warn)',
  HIGH: 'var(--critical)',
};

export function TopBar() {
  const now = useNow(1000);
  const reticle = useUi((s) => s.reticle);
  const threat = useQuery(api.threat.latest, {});
  const level = threat?.level ?? 'NOMINAL';

  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--s4)',
        height: 40,
        padding: '0 var(--s4)',
        background: 'var(--bg-1)',
        borderBottom: '1px solid var(--border-hairline)',
        flexShrink: 0,
      }}
    >
      <span
        className="mono"
        style={{ fontWeight: 700, letterSpacing: '0.18em', color: 'var(--text-1)', fontSize: 13 }}
      >
        BLINDSPOT
      </span>
      <span className="microlabel">// VANCOUVER ISLAND</span>

      <div style={{ flex: 1 }} />

      {reticle && (
        <span className="mono" style={{ color: 'var(--text-2)' }}>
          {formatCoord(reticle.lat, reticle.lng)}
        </span>
      )}

      <span className="pill" style={{ color: THREAT_TONE[level] }} title={threat ? `score ${threat.score.toFixed(1)}` : undefined}>
        <span className="dot" style={{ background: THREAT_TONE[level] }} />
        SYSTEM {level}
      </span>

      <span className="mono" style={{ color: 'var(--text-2)' }}>
        {formatLocal(now)} <span style={{ color: 'var(--text-3)' }}>LOC</span>
      </span>
      <span className="mono" style={{ color: 'var(--text-1)' }}>
        {formatUtc(now)}
      </span>
    </header>
  );
}
