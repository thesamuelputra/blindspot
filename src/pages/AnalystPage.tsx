import { useEffect, useRef, useState } from 'react';
import { useAction, useQuery } from 'convex/react';
import { useNavigate } from '@tanstack/react-router';
import { api } from '../../convex/_generated/api';
import { useUi } from '@/state/ui';

// ANALYST (BRIEF §4 page 10, §8.6). Left 60%: the natural-language console
// over the live data, backed by the read-only tool loop in
// convex/brain/analyst.ts ({prose, highlights?}). Right 40%: the INTSUM
// product with on-demand regenerate. Highlights jump to COMMAND via the
// shared flyTo request in ui state.

interface Highlights {
  signalIds: string[];
  entityIds: string[];
  bbox?: [number, number, number, number]; // [west, south, east, north]
}

interface Turn {
  role: 'user' | 'assistant';
  content: string;
  highlights?: Highlights;
  elapsedMs?: number;
}

const STARTERS = [
  'what changed in the last hour',
  'any vessels near Victoria right now',
  'summarize active hazards',
  'how healthy are the feeds',
];

function fmtUtcStamp(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + 'Z';
}

function bboxToFly(b: [number, number, number, number]): { lat: number; lng: number; zoom: number } {
  const [w, s, e, n] = b;
  const span = Math.max(Math.abs(e - w), Math.abs(n - s), 0.01);
  const zoom = Math.max(5, Math.min(13, Math.floor(Math.log2(360 / span))));
  return { lat: (s + n) / 2, lng: (w + e) / 2, zoom };
}

function latencyLabel(t: Turn): string {
  const secs = ((t.elapsedMs ?? 0) / 1000).toFixed(1);
  const n = t.highlights ? t.highlights.signalIds.length + t.highlights.entityIds.length : 0;
  return n > 0 ? `consulted ${n} sources in ${secs}s` : `answered in ${secs}s`;
}

export function AnalystPage() {
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', minHeight: 0 }}>
      <style>{'@keyframes bsAnalystPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }'}</style>
      <Console />
      <IntsumPanel />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Left 60%: the console
// ---------------------------------------------------------------------------

function Console() {
  const ask = useAction(api.brain.analyst.ask);
  const requestFlyTo = useUi((s) => s.requestFlyTo);
  const navigate = useNavigate();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns.length, busy]);

  const send = async (raw: string) => {
    const question = raw.trim();
    if (!question || busy) return;
    const history = turns.slice(-6).map((t) => ({ role: t.role, content: t.content }));
    setInput('');
    setBusy(true);
    setTurns((t) => [...t, { role: 'user', content: question }]);
    const t0 = performance.now();
    try {
      const res = await ask({ question, history });
      setTurns((t) => [
        ...t,
        {
          role: 'assistant',
          content: res.prose,
          highlights: res.highlights,
          elapsedMs: performance.now() - t0,
        },
      ]);
    } catch {
      setTurns((t) => [
        ...t,
        {
          role: 'assistant',
          content: 'The analyst call failed. Check the connection and try again.',
          elapsedMs: performance.now() - t0,
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const viewOnMap = (h: Highlights) => {
    if (h.bbox) requestFlyTo(bboxToFly(h.bbox));
    void navigate({ to: '/command' });
  };

  return (
    <section style={{ width: '60%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 16px',
          borderBottom: '1px solid var(--border-hairline)',
          flexShrink: 0,
        }}
      >
        <span className="microlabel" style={{ color: 'var(--intel)' }}>
          ANALYST
        </span>
        <span className="microlabel">// NL CONSOLE · READ ONLY OVER LIVE DATA</span>
      </header>

      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          minHeight: 0,
        }}
      >
        {turns.length === 0 && !busy && <EmptyState onPick={send} />}
        {turns.map((t, i) =>
          t.role === 'user' ? (
            <div
              key={i}
              className="mono"
              style={{
                alignSelf: 'flex-end',
                maxWidth: '78%',
                background: 'var(--bg-2)',
                border: '1px solid var(--border-hairline)',
                padding: '8px 10px',
                color: 'var(--text-1)',
                whiteSpace: 'pre-wrap',
              }}
            >
              {t.content}
            </div>
          ) : (
            <div key={i} style={{ alignSelf: 'flex-start', maxWidth: '85%' }}>
              <div
                style={{
                  fontSize: 13,
                  lineHeight: 1.65,
                  color: 'var(--text-1)',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {t.content}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
                <span className="microlabel">{latencyLabel(t)}</span>
                {t.highlights && (
                  <button
                    onClick={() => viewOnMap(t.highlights as Highlights)}
                    className="microlabel"
                    style={{
                      background: 'none',
                      border: '1px solid var(--intel)',
                      color: 'var(--intel)',
                      padding: '3px 8px',
                      cursor: 'pointer',
                    }}
                  >
                    VIEW ON MAP
                  </button>
                )}
              </div>
            </div>
          ),
        )}
        {busy && (
          <span
            className="microlabel"
            style={{
              alignSelf: 'flex-start',
              color: 'var(--intel)',
              animation: 'bsAnalystPulse 1.6s ease-in-out infinite',
            }}
          >
            ANALYZING…
          </span>
        )}
      </div>

      <div
        style={{
          display: 'flex',
          gap: 8,
          padding: 12,
          borderTop: '1px solid var(--border-hairline)',
          flexShrink: 0,
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
          rows={2}
          placeholder="Ask about the live picture. Enter sends, Shift+Enter for a new line."
          className="mono"
          style={{
            flex: 1,
            background: 'var(--bg-1)',
            border: '1px solid var(--border-hairline)',
            color: 'var(--text-1)',
            padding: '8px 10px',
            resize: 'none',
            outline: 'none',
            lineHeight: 1.5,
          }}
        />
        <button
          onClick={() => void send(input)}
          disabled={busy || input.trim().length === 0}
          className="microlabel"
          style={{
            background: 'var(--bg-2)',
            border: '1px solid var(--border-hairline-strong)',
            color: busy || input.trim().length === 0 ? 'var(--text-3)' : 'var(--text-1)',
            padding: '0 16px',
            cursor: busy || input.trim().length === 0 ? 'default' : 'pointer',
          }}
        >
          ASK
        </button>
      </div>
    </section>
  );
}

function EmptyState({ onPick }: { onPick: (q: string) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 24 }}>
      <span className="microlabel" style={{ marginBottom: 4 }}>
        ASK THE ANALYST · TRY ONE OF THESE
      </span>
      {STARTERS.map((q) => (
        <button
          key={q}
          onClick={() => onPick(q)}
          className="mono"
          style={{
            alignSelf: 'flex-start',
            background: 'var(--bg-1)',
            border: '1px solid var(--border-hairline)',
            color: 'var(--text-2)',
            padding: '6px 12px',
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          {q}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Right 40%: the INTSUM panel
// ---------------------------------------------------------------------------

function IntsumPanel() {
  const latest = useQuery(api.intsums.latest);
  const recent = useQuery(api.intsums.recent, { limit: 11 });
  const regenerate = useAction(api.intsums.regenerate);
  const [regenBusy, setRegenBusy] = useState(false);

  const prior = (recent ?? []).filter((r) => r._id !== latest?._id).slice(0, 10);

  const onRegenerate = async () => {
    if (regenBusy) return;
    setRegenBusy(true);
    try {
      await regenerate({});
    } catch {
      // the latest query stays as-is; the next attempt or cron recovers
    } finally {
      setRegenBusy(false);
    }
  };

  return (
    <aside
      style={{
        width: '40%',
        borderLeft: '1px solid var(--border-hairline)',
        background: 'var(--bg-1)',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 16px',
          borderBottom: '1px solid var(--border-hairline)',
          flexShrink: 0,
        }}
      >
        <span className="microlabel" style={{ color: 'var(--intel)' }}>
          INTSUM
        </span>
        <span className="microlabel">// AUTO EVERY 4H</span>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => void onRegenerate()}
          disabled={regenBusy}
          className="microlabel"
          style={{
            background: 'none',
            border: '1px solid var(--border-hairline-strong)',
            color: regenBusy ? 'var(--text-3)' : 'var(--text-1)',
            padding: '3px 10px',
            cursor: regenBusy ? 'default' : 'pointer',
            ...(regenBusy ? { animation: 'bsAnalystPulse 1.6s ease-in-out infinite' } : {}),
          }}
        >
          {regenBusy ? 'WORKING…' : 'REGENERATE'}
        </button>
      </header>

      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        <div style={{ padding: 16, borderBottom: '1px solid var(--border-hairline)' }}>
          {latest === undefined && <span className="microlabel">LOADING…</span>}
          {latest === null && (
            <p style={{ color: 'var(--text-2)', fontSize: 12, margin: 0 }}>
              No INTSUM yet. The cron writes one every 4 hours, or generate one now.
            </p>
          )}
          {latest && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <span className="mono" style={{ color: 'var(--text-2)' }}>
                  {fmtUtcStamp(latest.at)}
                </span>
                <span className="pill" style={{ color: 'var(--intel)' }}>
                  {latest.model}
                </span>
              </div>
              <div
                style={{
                  fontSize: 12.5,
                  lineHeight: 1.65,
                  color: 'var(--text-1)',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {latest.text}
              </div>
            </>
          )}
        </div>

        <div style={{ padding: '12px 16px 16px' }}>
          <div className="microlabel" style={{ marginBottom: 8 }}>
            PRIOR INTSUMS · {prior.length}
          </div>
          {prior.length === 0 && (
            <span className="mono" style={{ color: 'var(--text-3)' }}>
              none yet
            </span>
          )}
          {prior.map((row) => (
            <PriorIntsum key={row._id} at={row.at} text={row.text} model={row.model} />
          ))}
        </div>
      </div>
    </aside>
  );
}

function PriorIntsum({ at, text, model }: { at: number; text: string; model: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ borderBottom: '1px solid var(--border-hairline)' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          background: 'none',
          border: 'none',
          padding: '7px 0',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span className="mono" style={{ color: 'var(--text-3)', width: 14 }}>
          {open ? '▾' : '▸'}
        </span>
        <span className="mono" style={{ color: 'var(--text-2)' }}>
          {fmtUtcStamp(at)}
        </span>
        <span className="microlabel" style={{ marginLeft: 'auto' }}>
          {model}
        </span>
      </button>
      {open && (
        <div
          style={{
            fontSize: 12,
            lineHeight: 1.6,
            color: 'var(--text-2)',
            whiteSpace: 'pre-wrap',
            padding: '0 0 10px 22px',
          }}
        >
          {text}
        </div>
      )}
    </div>
  );
}
