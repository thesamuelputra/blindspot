import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import { useNow } from '@/lib/time';

// Top-bar alert chip (ARCHITECTURE §7.6, BRIEF §12 "N ALERTS" status line).
// Shows the unacked count colored by the worst severity present; the dot
// pulses while a critical is open. Click opens the recent-20 panel with
// per-row ack and ACK ALL.

const SEV_RANK: Record<string, number> = { info: 0, watch: 1, warning: 2, critical: 3 };

const SEV_COLOR: Record<string, string> = {
  critical: 'var(--critical)',
  warning: 'var(--warn)',
  watch: 'var(--warn)',
  info: 'var(--text-2)',
};

function ago(now: number, ts: number): string {
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function AlertBell() {
  const unacked = useQuery(api.notifications.unacked);
  const [open, setOpen] = useState(false);
  const recent = useQuery(api.notifications.recent, open ? { limit: 20 } : 'skip');
  const ack = useMutation(api.notifications.ack);
  const ackAll = useMutation(api.notifications.ackAll);
  const now = useNow(5000);
  const reduced = prefersReducedMotion();
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const count = unacked?.length ?? 0;
  let maxSev = 'info';
  for (const n of unacked ?? []) {
    if ((SEV_RANK[n.severity] ?? 0) > (SEV_RANK[maxSev] ?? 0)) maxSev = n.severity;
  }
  const color = count === 0 ? 'var(--text-3)' : (SEV_COLOR[maxSev] ?? 'var(--text-2)');
  const critical = count > 0 && maxSev === 'critical';

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <style>{`@keyframes bs-bell-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.25; } }`}</style>

      <button
        onClick={() => setOpen((o) => !o)}
        className="pill"
        title="Alerts"
        style={{ color, background: 'none', cursor: 'pointer' }}
      >
        <span
          className="dot"
          style={{
            background: color,
            animation: critical && !reduced ? 'bs-bell-pulse 1.2s ease-in-out infinite' : undefined,
          }}
        />
        {count} {count === 1 ? 'ALERT' : 'ALERTS'}
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            width: 348,
            maxHeight: 420,
            zIndex: 50,
            background: 'rgba(13,17,23,0.97)',
            border: '1px solid var(--border-hairline-strong)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <header
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 12px',
              borderBottom: '1px solid var(--border-hairline)',
              flexShrink: 0,
            }}
          >
            <span className="microlabel" style={{ color: 'var(--accent-live)' }}>
              ALERTS
            </span>
            <span className="microlabel">{count} OPEN</span>
            <div style={{ flex: 1 }} />
            <button
              onClick={() => void ackAll()}
              disabled={count === 0}
              className="mono"
              style={{
                background: 'none',
                border: '1px solid var(--border-hairline)',
                color: count === 0 ? 'var(--text-3)' : 'var(--text-2)',
                cursor: count === 0 ? 'default' : 'pointer',
                fontSize: 10,
                letterSpacing: '0.1em',
                padding: '1px 8px',
              }}
            >
              ACK ALL
            </button>
          </header>

          <div style={{ overflowY: 'auto' }}>
            {recent === undefined && (
              <div className="microlabel" style={{ padding: 12 }}>
                LOADING…
              </div>
            )}
            {recent !== undefined && recent.length === 0 && (
              <div className="mono" style={{ padding: 12, color: 'var(--text-3)', fontSize: 11 }}>
                No alerts yet. The board is quiet.
              </div>
            )}
            {recent?.map((n) => {
              const c = SEV_COLOR[n.severity] ?? 'var(--text-2)';
              return (
                <div
                  key={n._id}
                  style={{
                    display: 'flex',
                    gap: 8,
                    padding: '7px 12px 7px 10px',
                    borderLeft: `2px solid ${n.ack ? 'transparent' : c}`,
                    borderBottom: '1px solid var(--border-hairline)',
                    opacity: n.ack ? 0.55 : 1,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      className="mono"
                      style={{
                        color: 'var(--text-1)',
                        fontSize: 11,
                        fontWeight: 600,
                        lineHeight: 1.35,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={n.title}
                    >
                      {n.title}
                    </div>
                    <div className="microlabel" style={{ marginTop: 1 }}>
                      <span style={{ color: c }}>{n.severity}</span>
                      {' · '}
                      {ago(now, n.at)}
                    </div>
                  </div>
                  {n.ack ? (
                    <span className="microlabel" style={{ alignSelf: 'center', flexShrink: 0 }}>
                      ACKED
                    </span>
                  ) : (
                    <button
                      onClick={() => void ack({ id: n._id })}
                      className="mono"
                      style={{
                        alignSelf: 'center',
                        flexShrink: 0,
                        background: 'none',
                        border: '1px solid var(--border-hairline)',
                        color: 'var(--text-2)',
                        cursor: 'pointer',
                        fontSize: 10,
                        letterSpacing: '0.1em',
                        padding: '1px 8px',
                      }}
                    >
                      ACK
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
