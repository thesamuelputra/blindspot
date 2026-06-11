import { Link } from '@tanstack/react-router';

const PAGES: Array<{ to: string; label: string }> = [
  { to: '/command', label: 'COMMAND' },
  { to: '/hazard', label: 'HAZARD' },
  { to: '/skies-seas', label: 'SKIES & SEAS' },
  { to: '/ground', label: 'GROUND' },
  { to: '/signals', label: 'SIGNALS' },
  { to: '/infrastructure', label: 'INFRA' },
  { to: '/pulse', label: 'PULSE' },
  { to: '/environment', label: 'ENVIRO' },
  { to: '/space', label: 'SPACE' },
  { to: '/analyst', label: 'ANALYST' },
  { to: '/incidents', label: 'INCIDENTS' },
  { to: '/world', label: 'WORLD' },
  { to: '/cams', label: 'CAMS' },
  { to: '/system', label: 'SYSTEM' },
  { to: '/wall', label: 'WALL' },
];

export function NavRail() {
  return (
    <nav
      style={{
        width: 132,
        flexShrink: 0,
        background: 'var(--bg-1)',
        borderRight: '1px solid var(--border-hairline)',
        padding: 'var(--s2) 0',
        overflowY: 'auto',
      }}
    >
      {PAGES.map((p) => (
        <Link
          key={p.to}
          to={p.to}
          className="mono"
          style={{
            display: 'block',
            padding: '7px var(--s4)',
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
          {p.label}
        </Link>
      ))}
    </nav>
  );
}
