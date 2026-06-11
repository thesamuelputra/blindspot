import { useNow, formatUtc, formatLocal, formatCoord } from '@/lib/time';
import { useUi } from '@/state/ui';

export function TopBar() {
  const now = useNow(1000);
  const reticle = useUi((s) => s.reticle);

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

      <span className="pill" style={{ color: 'var(--ok)' }}>
        <span className="dot" style={{ background: 'var(--ok)' }} />
        SYSTEM NOMINAL
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
