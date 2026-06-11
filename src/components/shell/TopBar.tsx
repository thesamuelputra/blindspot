import { useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import { useNow, formatUtc, formatLocal, formatCoord } from '@/lib/time';
import { useUi } from '@/state/ui';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { AlertBell } from '@/components/alerts/AlertBell';
import { PushSubscribe } from '@/components/alerts/PushSubscribe';

const THREAT_TONE: Record<string, string> = {
  NOMINAL: 'var(--ok)',
  ELEVATED: 'var(--warn)',
  HIGH: 'var(--critical)',
};

export function TopBar() {
  const now = useNow(1000);
  const reticle = useUi((s) => s.reticle);
  const threat = useQuery(api.threat.latest, {});
  // Below 880px drop the reticle readout, push opt-in, and LOC clock; below
  // 560px the subtitle goes too. AlertBell, threat pill, and UTC always stay.
  const compact = useMediaQuery('(max-width: 879px)');
  const tiny = useMediaQuery('(max-width: 559px)');
  const level = threat?.level ?? 'NOMINAL';

  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: compact ? 'var(--s2)' : 'var(--s4)',
        height: 40,
        padding: '0 var(--s4)',
        background: 'var(--bg-1)',
        borderBottom: '1px solid var(--border-hairline)',
        flexShrink: 0,
        minWidth: 0,
      }}
    >
      <span
        className="mono"
        style={{
          fontWeight: 700,
          letterSpacing: '0.18em',
          color: 'var(--text-1)',
          fontSize: 13,
          flexShrink: 0,
          whiteSpace: 'nowrap',
        }}
      >
        BLINDSPOT
      </span>
      {!tiny && (
        <span
          className="microlabel"
          style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}
        >
          // VANCOUVER ISLAND
        </span>
      )}

      <div style={{ flex: 1 }} />

      {!compact && reticle && (
        <span
          className="mono"
          style={{
            color: 'var(--text-2)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            minWidth: 0,
          }}
        >
          {formatCoord(reticle.lat, reticle.lng)}
        </span>
      )}

      {!compact && <PushSubscribe />}
      <div style={{ flexShrink: 0 }}>
        <AlertBell />
      </div>
      <span
        className="pill"
        style={{ color: THREAT_TONE[level], flexShrink: 0, whiteSpace: 'nowrap' }}
        title={threat ? `score ${threat.score.toFixed(1)}` : undefined}
      >
        <span className="dot" style={{ background: THREAT_TONE[level] }} />
        {tiny ? level : `SYSTEM ${level}`}
      </span>

      {!compact && (
        <span className="mono" style={{ color: 'var(--text-2)', flexShrink: 0, whiteSpace: 'nowrap' }}>
          {formatLocal(now)} <span style={{ color: 'var(--text-3)' }}>LOC</span>
        </span>
      )}
      <span className="mono" style={{ color: 'var(--text-1)', flexShrink: 0, whiteSpace: 'nowrap' }}>
        {formatUtc(now)}
      </span>
    </header>
  );
}
