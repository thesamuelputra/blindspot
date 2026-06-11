import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import { useNow } from '@/lib/time';

// Alert toasts (ARCHITECTURE §7.6, BRIEF §8.8): the in-app channel of the
// alerting pipeline. Subscribes to unacked notifications; new criticals that
// arrive while mounted get one spoken warning (TTS), gated on tab visibility
// and a session mute flag. Mounted once inside the authenticated shell.

const SEV_COLOR: Record<string, string> = {
  critical: 'var(--critical)',
  warning: 'var(--warn)',
  watch: 'var(--warn)',
  info: 'var(--text-2)',
};

const MUTE_KEY = 'bs.alert-voice-muted';

function ago(now: number, ts: number): string {
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function AlertToasts() {
  const unacked = useQuery(api.notifications.unacked);
  const ack = useMutation(api.notifications.ack);
  const now = useNow(1000);
  const reduced = prefersReducedMotion();
  const [muted, setMuted] = useState(() => sessionStorage.getItem(MUTE_KEY) === '1');
  // ids already on the board; seeded on first load so criticals that were
  // sitting unacked before this mount do not speak
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (unacked === undefined) return;
    if (seen.current === null) {
      seen.current = new Set(unacked.map((n) => n._id));
      return;
    }
    for (const n of unacked) {
      if (seen.current.has(n._id)) continue;
      seen.current.add(n._id);
      if (
        n.severity === 'critical' &&
        !muted &&
        document.visibilityState === 'visible' &&
        'speechSynthesis' in window
      ) {
        const u = new SpeechSynthesisUtterance(`Warning: ${n.title}`);
        u.rate = 1.05;
        window.speechSynthesis.speak(u);
      }
    }
  }, [unacked, muted]);

  const toggleMute = () => {
    const next = !muted;
    sessionStorage.setItem(MUTE_KEY, next ? '1' : '0');
    if (next && 'speechSynthesis' in window) window.speechSynthesis.cancel();
    setMuted(next);
  };

  if (!unacked || unacked.length === 0) return null;

  const visible = unacked.slice(0, 4);
  const overflow = unacked.length - visible.length;

  return (
    <div
      style={{
        position: 'fixed',
        top: 48,
        right: 12,
        width: 324,
        zIndex: 40,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        pointerEvents: 'none',
      }}
    >
      <style>{`@keyframes bs-toast-in { from { opacity: 0; transform: translateX(12px); } to { opacity: 1; transform: none; } }`}</style>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, pointerEvents: 'auto' }}>
        <span className="microlabel">ALERTS · {unacked.length} OPEN</span>
        <div style={{ flex: 1 }} />
        <button
          onClick={toggleMute}
          className="mono"
          title={muted ? 'Spoken warnings are off for this session' : 'Spoken warnings are on'}
          style={{
            background: 'var(--bg-1)',
            border: '1px solid var(--border-hairline)',
            color: muted ? 'var(--text-3)' : 'var(--text-2)',
            cursor: 'pointer',
            fontSize: 10,
            letterSpacing: '0.1em',
            padding: '1px 7px',
          }}
        >
          {muted ? 'VOICE OFF' : 'VOICE ON'}
        </button>
      </div>

      {visible.map((n) => {
        const color = SEV_COLOR[n.severity] ?? 'var(--text-2)';
        return (
          <div
            key={n._id}
            style={{
              background: 'rgba(13,17,23,0.96)',
              border: '1px solid var(--border-hairline-strong)',
              borderLeft: `2px solid ${color}`,
              backdropFilter: 'blur(6px)',
              padding: '8px 10px',
              pointerEvents: 'auto',
              animation: reduced ? undefined : 'bs-toast-in 180ms var(--ease-ops)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span
                className="mono"
                style={{ fontWeight: 700, color: 'var(--text-1)', flex: 1, lineHeight: 1.35 }}
              >
                {n.title}
              </span>
              <span className="microlabel" style={{ flexShrink: 0 }}>
                {ago(now, n.at)}
              </span>
            </div>
            {n.body && (
              <p
                style={{
                  margin: '4px 0 0',
                  color: 'var(--text-2)',
                  fontSize: 12,
                  lineHeight: 1.45,
                  display: '-webkit-box',
                  WebkitLineClamp: 3,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}
              >
                {n.body}
              </p>
            )}
            <div style={{ display: 'flex', alignItems: 'center', marginTop: 6 }}>
              <span className="microlabel" style={{ color }}>
                {n.severity}
              </span>
              <div style={{ flex: 1 }} />
              <button
                onClick={() => void ack({ id: n._id })}
                className="mono"
                style={{
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
            </div>
          </div>
        );
      })}

      {overflow > 0 && (
        <div
          className="mono"
          style={{
            color: 'var(--text-3)',
            fontSize: 11,
            textAlign: 'right',
            paddingRight: 2,
            pointerEvents: 'auto',
          }}
        >
          +{overflow} more
        </div>
      )}
    </div>
  );
}
