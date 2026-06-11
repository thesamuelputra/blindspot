import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';

// Compact dropdown for the Inspector signal panel (ARCHITECTURE §7.8):
// attach the inspected signal to an open incident, or open a new one inline.
// Self-contained: owns its queries, takes only the signal id.

const rowStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  background: 'none',
  border: 'none',
  borderBottom: '1px solid var(--border-hairline)',
  color: 'var(--text-1)',
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  padding: '6px 10px',
  cursor: 'pointer',
};

export function AddToIncident({ signalId }: { signalId: string }) {
  const [open, setOpen] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [title, setTitle] = useState('');
  const [attachedTo, setAttachedTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const incidents = useQuery(api.incidents.list, open ? {} : 'skip');
  const addSignal = useMutation(api.incidents.addSignal);
  const create = useMutation(api.incidents.create);

  // a new inspected signal means a fresh state
  useEffect(() => {
    setOpen(false);
    setDrafting(false);
    setTitle('');
    setAttachedTo(null);
    setBusy(false);
  }, [signalId]);

  const openIncidents = (incidents ?? []).filter((i) => i.status === 'open');

  async function attach(incidentId: Id<'incidents'>, incidentTitle: string) {
    setBusy(true);
    try {
      await addSignal({ incidentId, signalId: signalId as Id<'signals'> });
      setAttachedTo(incidentTitle);
      setOpen(false);
      setDrafting(false);
    } finally {
      setBusy(false);
    }
  }

  async function createAndAttach(e: FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const incidentId = await create({ title: trimmed });
      await addSignal({ incidentId, signalId: signalId as Id<'signals'> });
      setAttachedTo(trimmed);
      setTitle('');
      setOpen(false);
      setDrafting(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ position: 'relative', marginTop: 10 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="mono"
        style={{
          background: 'var(--bg-3)',
          border: '1px solid var(--border-hairline-strong)',
          color: 'var(--text-1)',
          fontSize: 10,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          padding: '4px 10px',
          cursor: 'pointer',
        }}
      >
        ADD TO INCIDENT {open ? '▴' : '▾'}
      </button>
      {attachedTo && !open && (
        <span className="mono" style={{ color: 'var(--ok)', fontSize: 10, marginLeft: 8 }}>
          added to {attachedTo}
        </span>
      )}

      {open && (
        <>
          {/* click-away backdrop */}
          <div
            onClick={() => setOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 40 }}
          />
          <div
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              marginTop: 4,
              width: 240,
              zIndex: 41,
              background: 'var(--bg-2)',
              border: '1px solid var(--border-hairline-strong)',
              boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            }}
          >
            <div
              className="microlabel"
              style={{ padding: '6px 10px', borderBottom: '1px solid var(--border-hairline)' }}
            >
              OPEN INCIDENTS
            </div>
            {incidents === undefined && (
              <div className="mono" style={{ padding: '6px 10px', color: 'var(--text-3)' }}>
                loading…
              </div>
            )}
            {incidents !== undefined && openIncidents.length === 0 && (
              <div className="mono" style={{ padding: '6px 10px', color: 'var(--text-3)' }}>
                none open
              </div>
            )}
            {openIncidents.map((inc) => (
              <button
                key={inc._id}
                disabled={busy}
                onClick={() => void attach(inc._id, inc.title)}
                style={rowStyle}
              >
                {inc.title}{' '}
                <span style={{ color: 'var(--text-3)', fontSize: 10 }}>{inc.signalCount} SIG</span>
              </button>
            ))}
            {!drafting ? (
              <button
                onClick={() => setDrafting(true)}
                style={{ ...rowStyle, color: 'var(--accent-live)', borderBottom: 'none' }}
              >
                new incident…
              </button>
            ) : (
              <form
                onSubmit={(e) => void createAndAttach(e)}
                style={{ display: 'flex', gap: 4, padding: 8 }}
              >
                <input
                  autoFocus
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="incident title"
                  className="mono"
                  style={{
                    flex: 1,
                    minWidth: 0,
                    background: 'var(--bg-0)',
                    border: '1px solid var(--border-hairline)',
                    color: 'var(--text-1)',
                    fontSize: 11,
                    padding: '4px 6px',
                    outline: 'none',
                  }}
                />
                <button
                  type="submit"
                  disabled={busy}
                  className="mono"
                  style={{
                    background: 'var(--bg-3)',
                    border: '1px solid var(--border-hairline-strong)',
                    color: 'var(--text-1)',
                    fontSize: 10,
                    padding: '4px 8px',
                    cursor: 'pointer',
                  }}
                >
                  OPEN
                </button>
              </form>
            )}
          </div>
        </>
      )}
    </div>
  );
}
