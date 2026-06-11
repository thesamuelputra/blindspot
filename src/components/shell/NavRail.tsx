import { Link } from '@tanstack/react-router';
import { useMediaQuery } from '@/lib/useMediaQuery';

const PAGES: Array<{ to: string; label: string; code: string }> = [
  { to: '/command', label: 'COMMAND', code: 'CO' },
  { to: '/hazard', label: 'HAZARD', code: 'HA' },
  { to: '/skies-seas', label: 'SKIES & SEAS', code: 'SK' },
  { to: '/ground', label: 'GROUND', code: 'GR' },
  { to: '/signals', label: 'SIGNALS', code: 'SI' },
  { to: '/infrastructure', label: 'INFRA', code: 'IN' },
  { to: '/pulse', label: 'PULSE', code: 'PU' },
  { to: '/environment', label: 'ENVIRO', code: 'EN' },
  { to: '/space', label: 'SPACE', code: 'SP' },
  { to: '/analyst', label: 'ANALYST', code: 'AN' },
  { to: '/incidents', label: 'INCIDENTS', code: 'IC' },
  { to: '/world', label: 'WORLD', code: 'WO' },
  { to: '/cams', label: 'CAMS', code: 'CA' },
  { to: '/system', label: 'SYSTEM', code: 'SY' },
  { to: '/wall', label: 'WALL', code: 'WA' },
];

export function NavRail() {
  // Below 880px the rail collapses to two-letter codes so the map keeps room.
  const compact = useMediaQuery('(max-width: 879px)');

  return (
    <nav
      style={{
        width: compact ? 44 : 132,
        flexShrink: 0,
        background: 'var(--bg-1)',
        borderRight: '1px solid var(--border-hairline)',
        padding: 'var(--s2) 0',
        overflowY: 'auto',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      {PAGES.map((p) => (
        <Link
          key={p.to}
          to={p.to}
          className="mono"
          title={p.label}
          style={{
            display: 'block',
            padding: compact ? '7px 0' : '7px var(--s4)',
            textAlign: compact ? 'center' : undefined,
            fontSize: 10,
            letterSpacing: '0.12em',
            textDecoration: 'none',
            color: 'var(--text-3)',
            borderLeft: '2px solid transparent',
            transition: 'color var(--t-fast) var(--ease-ops)',
          }}
          activeProps={{
            style: {
              color: 'var(--accent-live)',
              borderLeft: '2px solid var(--accent-live)',
              background: 'var(--bg-2)',
            },
          }}
        >
          {compact ? p.code : p.label}
        </Link>
      ))}
      <div style={{ flex: 1 }} />
      {!compact && (
        <div
          className="microlabel"
          style={{ padding: '10px 8px', fontSize: 8, lineHeight: 1.6, color: 'var(--text-3)' }}
          title="Aggregated public OSINT. Informational only. Not for life safety decisions."
        >
          PUBLIC OSINT
          <br />
          NOT FOR LIFE SAFETY
        </div>
      )}
      </div>
    </nav>
  );
}
