import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { create } from 'zustand';
import { useUi } from '@/state/ui';

// Time scrubber (ARCHITECTURE §8, BRIEF §8.4): LIVE shows a slim status pill;
// REPLAY docks the full transport bar — window select, playhead slider with a
// mono UTC readout, play/pause with speed steps. The replay window is anchored
// to the moment replay was entered; MapView reads it via useReplayWindow.

const HOUR_MS = 3_600_000;
const WINDOWS: Array<1 | 6 | 24 | 48> = [1, 6, 24, 48];
const SPEEDS = [10, 60];
const TICK_MS = 250;

interface AnchorState {
  anchorMs: number;
  setAnchor: (ms: number) => void;
}

const useReplayAnchor = create<AnchorState>((set) => ({
  anchorMs: Date.now(),
  setAnchor: (anchorMs) => set({ anchorMs }),
}));

// Replay window for the current scrubber state; null in live mode.
// MapView feeds this to api.replay.* (skip-pattern when null).
export function useReplayWindow(): { fromMs: number; toMs: number } | null {
  const mode = useUi((s) => s.time.mode);
  const windowH = useUi((s) => s.time.windowH);
  const anchorMs = useReplayAnchor((s) => s.anchorMs);
  if (mode !== 'replay') return null;
  return { fromMs: anchorMs - windowH * HOUR_MS, toMs: anchorMs };
}

function formatUtcStamp(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}Z`;
}

const chrome: CSSProperties = {
  position: 'absolute',
  // sits above the rolling event ticker (which owns the bottom 12px strip)
  bottom: 50,
  zIndex: 15,
  display: 'flex',
  alignItems: 'center',
  background: 'rgba(13,17,23,0.92)',
  border: '1px solid var(--border-hairline)',
  backdropFilter: 'blur(4px)',
};

function Btn({
  active,
  onClick,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="mono"
      style={{
        background: active ? 'var(--bg-3)' : 'none',
        border: `1px solid ${active ? 'var(--border-hairline-strong)' : 'var(--border-hairline)'}`,
        color: active ? 'var(--text-1)' : 'var(--text-2)',
        cursor: 'pointer',
        fontSize: 10,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        padding: '3px 8px',
      }}
    >
      {children}
    </button>
  );
}

export function TimeScrubber() {
  const time = useUi((s) => s.time);
  const setTimeMode = useUi((s) => s.setTimeMode);
  const setPlayhead = useUi((s) => s.setPlayhead);
  const setWindowH = useUi((s) => s.setWindowH);
  const anchorMs = useReplayAnchor((s) => s.anchorMs);
  const setAnchor = useReplayAnchor((s) => s.setAnchor);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(SPEEDS[0]);

  const reducedMotion = useRef(
    typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  ).current;

  const fromMs = anchorMs - time.windowH * HOUR_MS;
  const toMs = anchorMs;

  // Auto-advance: every tick, move the playhead speed * tick forward.
  useEffect(() => {
    if (time.mode !== 'replay' || !playing) return;
    const id = setInterval(() => {
      const s = useUi.getState();
      const next = s.time.t + speed * TICK_MS;
      if (next >= toMs) {
        s.setPlayhead(toMs);
        setPlaying(false);
      } else {
        s.setPlayhead(next);
      }
    }, TICK_MS);
    return () => clearInterval(id);
  }, [time.mode, playing, speed, toMs]);

  // Keep the playhead inside the window when the window changes.
  useEffect(() => {
    if (time.mode !== 'replay') return;
    const t = useUi.getState().time.t;
    if (t < fromMs) setPlayhead(fromMs);
    else if (t > toMs) setPlayhead(toMs);
  }, [time.mode, fromMs, toMs, setPlayhead]);

  const enterReplay = () => {
    const now = Date.now();
    setAnchor(now);
    setTimeMode('replay');
    setPlayhead(now - time.windowH * HOUR_MS);
    // Reduced motion: start paused, the operator drives the slider.
    setPlaying(!reducedMotion);
  };

  const exitReplay = () => {
    setPlaying(false);
    setTimeMode('live');
  };

  if (time.mode === 'live') {
    return (
      <div style={{ ...chrome, left: 220, gap: 10, padding: '5px 10px' }}>
        <span className="pill" style={{ color: 'var(--ok)', border: 'none', padding: 0 }}>
          <span className="dot" style={{ background: 'var(--ok)' }} />
          LIVE
        </span>
        <Btn onClick={enterReplay}>REPLAY</Btn>
      </div>
    );
  }

  const playhead = Math.min(Math.max(time.t, fromMs), toMs);

  return (
    <div style={{ ...chrome, left: 220, right: 340, gap: 'var(--s3)', padding: '7px 12px' }}>
      <Btn onClick={exitReplay}>LIVE</Btn>
      <span
        className="mono"
        style={{
          background: 'var(--bg-3)',
          border: '1px solid var(--border-hairline-strong)',
          color: 'var(--accent-live)',
          fontSize: 10,
          letterSpacing: '0.1em',
          padding: '3px 8px',
        }}
      >
        REPLAY
      </span>

      <span style={{ width: 1, alignSelf: 'stretch', background: 'var(--border-hairline)' }} />

      {WINDOWS.map((h) => (
        <Btn key={h} active={time.windowH === h} onClick={() => setWindowH(h)}>
          {h}H
        </Btn>
      ))}

      <span style={{ width: 1, alignSelf: 'stretch', background: 'var(--border-hairline)' }} />

      <Btn onClick={() => setPlaying((p) => !p)}>{playing ? 'PAUSE' : 'PLAY'}</Btn>
      {SPEEDS.map((x) => (
        <Btn key={x} active={speed === x} onClick={() => setSpeed(x)}>
          {x}X
        </Btn>
      ))}

      <input
        type="range"
        min={fromMs}
        max={toMs}
        step={1000}
        value={playhead}
        onChange={(e) => {
          setPlaying(false);
          setPlayhead(Number(e.target.value));
        }}
        aria-label="Replay playhead"
        style={{ flex: 1, accentColor: 'var(--accent-live)', height: 14, margin: 0 }}
      />

      <span className="mono" style={{ color: 'var(--accent-live)', whiteSpace: 'nowrap' }}>
        {formatUtcStamp(playhead)}
      </span>
      <span className="microlabel" style={{ whiteSpace: 'nowrap' }}>
        OF {formatUtcStamp(toMs)}
      </span>
    </div>
  );
}
