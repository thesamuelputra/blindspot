import { useState } from 'react';
import { useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import { useNow, formatUtc } from '@/lib/time';
import { useMediaQuery } from '@/lib/useMediaQuery';

// Latest INTSUM on the COMMAND map (BRIEF §8.6) — collapsed to one line,
// expands on click. Full INTSUM history lives on the ANALYST page.
// Hidden below 880px: no room next to the layer rail; ANALYST carries it.
export function IntsumCard() {
  const latest = useQuery(api.intsums.latest, {});
  const [open, setOpen] = useState(false);
  const now = useNow(30_000);
  const compact = useMediaQuery('(max-width: 879px)');

  if (compact || !latest) return null;
  const age = Math.floor((now - latest.at) / 60_000);

  return (
    <div
      style={{
        position: 'absolute',
        left: 220,
        top: 12,
        zIndex: 10,
        maxWidth: 520,
        background: 'rgba(13,17,23,0.94)',
        border: '1px solid var(--border-hairline)',
        backdropFilter: 'blur(4px)',
      }}
    >
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: '6px 10px',
          textAlign: 'left',
        }}
      >
        <span className="microlabel" style={{ color: 'var(--intel)', flexShrink: 0 }}>
          INTSUM {formatUtc(latest.at)} · {age}m
        </span>
        {!open && (
          <span className="mono" style={{ fontSize: 11, color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {latest.text.split('\n')[0]}
          </span>
        )}
        <span className="microlabel" style={{ marginLeft: 'auto', flexShrink: 0 }}>
          {open ? '−' : '+'}
        </span>
      </button>
      {open && (
        <div
          className="mono"
          style={{ padding: '0 10px 10px', fontSize: 11.5, lineHeight: 1.6, color: 'var(--text-1)', whiteSpace: 'pre-wrap' }}
        >
          {latest.text}
        </div>
      )}
    </div>
  );
}
