import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { useNavigate } from '@tanstack/react-router';
import type { FunctionReturnType } from 'convex/server';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { useNow } from '@/lib/time';
import { useUi } from '@/state/ui';

// INCIDENTS workspace (ARCHITECTURE §7.8, BRIEF §8.11): bundle correlated
// signals into a saved incident, keep a timeline log, export a brief.

type IncidentDetail = NonNullable<FunctionReturnType<typeof api.incidents.get>>;
type IncidentStatus = 'open' | 'monitoring' | 'closed';

const STATUSES: IncidentStatus[] = ['open', 'monitoring', 'closed'];

function statusColor(status: IncidentStatus): string {
  if (status === 'open') return 'var(--accent-live)';
  if (status === 'monitoring') return 'var(--warn)';
  return 'var(--text-3)';
}

function severityColor(severity: string): string {
  if (severity === 'critical') return 'var(--critical)';
  if (severity === 'warning' || severity === 'watch') return 'var(--warn)';
  return 'var(--text-2)';
}

function age(now: number, ts: number): string {
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 90) return `${s}s`;
  if (s < 5400) return `${Math.floor(s / 60)}m`;
  if (s < 129600) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function stamp(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}Z`;
}

function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'incident';
}

function buildBrief(detail: IncidentDetail): string {
  const { incident, signals, events } = detail;
  const lines: string[] = [];
  lines.push(`# Incident brief: ${incident.title}`);
  lines.push('');
  lines.push(`Status: ${incident.status}`);
  lines.push(`Created: ${stamp(incident.createdAt)}`);
  lines.push(`Exported: ${stamp(Date.now())}`);
  lines.push(`Attached signals: ${signals.length}`);
  lines.push('');
  lines.push('## Timeline');
  lines.push('');
  if (events.length === 0) lines.push('No entries.');
  for (const e of events) lines.push(`- ${stamp(e.at)} ${e.auto ? '[auto]' : '[note]'} ${e.text}`);
  lines.push('');
  lines.push('## Signals');
  lines.push('');
  if (signals.length === 0) lines.push('None attached.');
  for (const s of signals) {
    let method = 'unknown';
    try {
      const prov = JSON.parse(s.provenance) as { method?: string };
      if (prov.method) method = prov.method;
    } catch {
      /* keep unknown */
    }
    lines.push(`### ${s.title}`);
    lines.push(`- Severity: ${s.severity}`);
    lines.push(`- Source: ${s.sourceSlug}`);
    lines.push(`- Observed: ${stamp(s.observedAt)}`);
    lines.push(`- Provenance method: ${method}`);
    if (s.lat !== undefined && s.lng !== undefined)
      lines.push(`- Position: ${s.lat.toFixed(4)}, ${s.lng.toFixed(4)}`);
    lines.push('');
  }
  return lines.join('\n');
}

function downloadBrief(detail: IncidentDetail) {
  const blob = new Blob([buildBrief(detail)], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${slugify(detail.incident.title)}.md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const inputStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  background: 'var(--bg-0)',
  border: '1px solid var(--border-hairline)',
  color: 'var(--text-1)',
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  padding: '5px 8px',
  outline: 'none',
};

const buttonStyle: React.CSSProperties = {
  background: 'var(--bg-3)',
  border: '1px solid var(--border-hairline-strong)',
  color: 'var(--text-1)',
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  padding: '5px 10px',
  cursor: 'pointer',
};

export function IncidentsPage() {
  const [selected, setSelected] = useState<Id<'incidents'> | null>(null);
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', minHeight: 0 }}>
      <IncidentList selected={selected} onSelect={setSelected} />
      <IncidentDetailPanel
        id={selected}
        onDeleted={() => setSelected(null)}
        key={selected ?? 'none'}
      />
    </div>
  );
}

function IncidentList({
  selected,
  onSelect,
}: {
  selected: Id<'incidents'> | null;
  onSelect: (id: Id<'incidents'>) => void;
}) {
  const now = useNow(5000);
  const incidents = useQuery(api.incidents.list);
  const create = useMutation(api.incidents.create);
  const [title, setTitle] = useState('');

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    const id = await create({ title });
    setTitle('');
    onSelect(id);
  }

  return (
    <div
      style={{
        width: 300,
        flexShrink: 0,
        borderRight: '1px solid var(--border-hairline)',
        background: 'var(--bg-1)',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      <div style={{ padding: 'var(--s3)', borderBottom: '1px solid var(--border-hairline)' }}>
        <div className="microlabel" style={{ marginBottom: 'var(--s2)' }}>
          INCIDENTS
        </div>
        <form onSubmit={(e) => void onCreate(e)} style={{ display: 'flex', gap: 'var(--s2)' }}>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="new incident title"
            style={inputStyle}
          />
          <button type="submit" style={buttonStyle}>
            OPEN
          </button>
        </form>
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {incidents === undefined && (
          <div className="mono" style={{ padding: 'var(--s3)', color: 'var(--text-3)' }}>
            loading…
          </div>
        )}
        {incidents !== undefined && incidents.length === 0 && (
          <div className="mono" style={{ padding: 'var(--s3)', color: 'var(--text-3)' }}>
            no incidents yet. open one above.
          </div>
        )}
        {(incidents ?? []).map((inc) => (
          <button
            key={inc._id}
            onClick={() => onSelect(inc._id)}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              background: selected === inc._id ? 'var(--bg-2)' : 'none',
              border: 'none',
              borderBottom: '1px solid var(--border-hairline)',
              borderLeft:
                selected === inc._id ? '2px solid var(--accent-live)' : '2px solid transparent',
              padding: '8px var(--s3)',
              cursor: 'pointer',
            }}
          >
            <div
              className="mono"
              style={{ color: 'var(--text-1)', fontWeight: 600, marginBottom: 4 }}
            >
              {inc.title}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)' }}>
              <span className="pill" style={{ color: statusColor(inc.status) }}>
                <span className="dot" style={{ background: statusColor(inc.status) }} />
                {inc.status}
              </span>
              <span className="mono" style={{ color: 'var(--text-3)', fontSize: 10 }}>
                {inc.signalCount} SIG
              </span>
              <span className="mono" style={{ color: 'var(--text-3)', fontSize: 10 }}>
                {age(now, inc.createdAt)} AGO
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function IncidentDetailPanel({
  id,
  onDeleted,
}: {
  id: Id<'incidents'> | null;
  onDeleted: () => void;
}) {
  const detail = useQuery(api.incidents.get, id ? { id } : 'skip');
  const setStatus = useMutation(api.incidents.setStatus);
  const addNote = useMutation(api.incidents.addNote);
  const removeIncident = useMutation(api.incidents.remove);
  const requestFlyTo = useUi((s) => s.requestFlyTo);
  const navigate = useNavigate();
  const now = useNow(5000);
  const [note, setNote] = useState('');

  if (!id) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span className="mono" style={{ color: 'var(--text-3)' }}>
          select an incident to see its log
        </span>
      </div>
    );
  }
  if (detail === undefined) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span className="mono" style={{ color: 'var(--text-3)' }}>
          loading…
        </span>
      </div>
    );
  }
  if (detail === null) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span className="mono" style={{ color: 'var(--text-3)' }}>
          incident not found
        </span>
      </div>
    );
  }

  const { incident, signals, events } = detail;

  async function onAddNote(e: FormEvent) {
    e.preventDefault();
    if (!note.trim() || !id) return;
    await addNote({ incidentId: id, text: note });
    setNote('');
  }

  async function onDelete() {
    if (!id) return;
    if (!window.confirm('Delete this incident and its log?')) return;
    await removeIncident({ id });
    onDeleted();
  }

  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--s3)',
          padding: 'var(--s3) var(--s4)',
          borderBottom: '1px solid var(--border-hairline)',
          background: 'var(--bg-1)',
          flexWrap: 'wrap',
        }}
      >
        <span
          className="mono"
          style={{ fontSize: 14, fontWeight: 700, letterSpacing: '0.04em', color: 'var(--text-1)' }}
        >
          {incident.title}
        </span>
        <span className="mono" style={{ color: 'var(--text-3)', fontSize: 10 }}>
          OPENED {stamp(incident.createdAt)}
        </span>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 'var(--s1)' }}>
          {STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => void setStatus({ id, status: s })}
              className="pill"
              style={{
                cursor: 'pointer',
                background: incident.status === s ? 'var(--bg-3)' : 'none',
                color: incident.status === s ? statusColor(s) : 'var(--text-3)',
                borderColor:
                  incident.status === s ? 'var(--border-hairline-strong)' : 'var(--border-hairline)',
              }}
            >
              {s}
            </button>
          ))}
        </div>
        <button onClick={() => downloadBrief(detail)} style={buttonStyle}>
          EXPORT BRIEF
        </button>
        <button
          onClick={() => void onDelete()}
          style={{ ...buttonStyle, color: 'var(--critical)' }}
        >
          DELETE
        </button>
      </header>

      <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--s4)' }}>
        <div className="microlabel" style={{ marginBottom: 'var(--s2)' }}>
          ATTACHED SIGNALS · {signals.length}
        </div>
        {signals.length === 0 && (
          <div className="mono" style={{ color: 'var(--text-3)', marginBottom: 'var(--s4)' }}>
            none yet. attach signals from the inspector.
          </div>
        )}
        <div style={{ marginBottom: 'var(--s6)' }}>
          {signals.map((sig) => (
            <div
              key={sig._id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--s3)',
                padding: '6px var(--s3)',
                borderBottom: '1px solid var(--border-hairline)',
                borderLeft: `2px solid ${severityColor(sig.severity)}`,
                background: 'var(--bg-1)',
              }}
            >
              <span
                className="microlabel"
                style={{ color: severityColor(sig.severity), width: 64, flexShrink: 0 }}
              >
                {sig.severity}
              </span>
              <span
                className="mono"
                style={{
                  color: 'var(--text-1)',
                  flex: 1,
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {sig.title}
              </span>
              <span className="mono" style={{ color: 'var(--text-3)', fontSize: 10 }}>
                {sig.sourceSlug}
              </span>
              <span className="mono" style={{ color: 'var(--text-3)', fontSize: 10 }}>
                {age(now, sig.observedAt)} AGO
              </span>
              {sig.lat !== undefined && sig.lng !== undefined && (
                <button
                  onClick={() => {
                    requestFlyTo({ lat: sig.lat!, lng: sig.lng!, zoom: 11 });
                    void navigate({ to: '/command' });
                  }}
                  style={{ ...buttonStyle, padding: '2px 8px' }}
                >
                  VIEW
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="microlabel" style={{ marginBottom: 'var(--s2)' }}>
          TIMELINE · {events.length}
        </div>
        <div>
          {events.map((e) => (
            <div
              key={e._id}
              style={{
                display: 'flex',
                gap: 'var(--s3)',
                padding: '5px 0',
                borderBottom: '1px solid var(--border-hairline)',
              }}
            >
              <span
                className="mono"
                style={{ color: 'var(--text-3)', fontSize: 10, width: 110, flexShrink: 0 }}
              >
                {stamp(e.at)}
              </span>
              <span
                className="microlabel"
                style={{
                  width: 38,
                  flexShrink: 0,
                  color: e.auto ? 'var(--text-3)' : 'var(--intel)',
                }}
              >
                {e.auto ? 'AUTO' : 'NOTE'}
              </span>
              <span
                className="mono"
                style={{ color: e.auto ? 'var(--text-2)' : 'var(--text-1)', minWidth: 0 }}
              >
                {e.text}
              </span>
            </div>
          ))}
        </div>
      </div>

      <form
        onSubmit={(e) => void onAddNote(e)}
        style={{
          display: 'flex',
          gap: 'var(--s2)',
          padding: 'var(--s3) var(--s4)',
          borderTop: '1px solid var(--border-hairline)',
          background: 'var(--bg-1)',
        }}
      >
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="add a note to the log"
          style={inputStyle}
        />
        <button type="submit" style={buttonStyle}>
          LOG
        </button>
      </form>
    </div>
  );
}
