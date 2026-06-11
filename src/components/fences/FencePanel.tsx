import { useState, type CSSProperties, type ReactNode } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import type { Doc } from '../../../convex/_generated/dataModel';
import { useFenceDraw } from './useFenceDraw';

// Geofence operator panel (BRIEF §8.2): list fences, toggle, delete, and draw
// new ones. Drawing is a shared-state affair — this panel flips the fence
// store into drawing mode and MapView feeds map clicks in as vertices (see
// fenceStore.ts). Docked bottom-left under the LayerRail, same chrome.

type Fence = Doc<'geofences'>;
type Rule = Fence['rule'];
type Severity = Fence['severity'];

const RULES: Rule[] = ['enter', 'exit', 'dwell'];
const SEVERITIES: Severity[] = ['info', 'watch', 'warning', 'critical'];
const ENTITY_KINDS = ['vessel', 'aircraft', 'ferry', 'bus'];
const RULE_ABBR: Record<Rule, string> = { enter: 'ENT', exit: 'EXT', dwell: 'DWL' };
const SEVERITY_COLOR: Record<Severity, string> = {
  info: 'var(--text-3)',
  watch: 'var(--warn)',
  warning: 'var(--warn)',
  critical: 'var(--critical)',
};

const inputStyle: CSSProperties = {
  width: '100%',
  background: 'var(--bg-2)',
  border: '1px solid var(--border-hairline)',
  borderRadius: 0,
  color: 'var(--text-1)',
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  letterSpacing: '0.05em',
  padding: '3px 6px',
};

function Btn({
  onClick,
  disabled,
  accent,
  title,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  accent?: boolean;
  title?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="mono"
      style={{
        background: accent ? 'var(--bg-3)' : 'none',
        border: `1px solid ${accent ? 'var(--border-hairline-strong)' : 'var(--border-hairline)'}`,
        color: disabled ? 'var(--text-3)' : accent ? 'var(--text-1)' : 'var(--text-2)',
        cursor: disabled ? 'default' : 'pointer',
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

function FenceRow({ fence }: { fence: Fence }) {
  const setActive = useMutation(api.geofences.setActive);
  const remove = useMutation(api.geofences.remove);
  return (
    <div
      className="mono"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        fontSize: 10,
        letterSpacing: '0.05em',
        color: fence.active ? 'var(--text-1)' : 'var(--text-3)',
      }}
    >
      <span
        title={fence.severity}
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: SEVERITY_COLOR[fence.severity],
          opacity: fence.severity === 'watch' ? 0.65 : 1,
          flexShrink: 0,
        }}
      />
      <span
        title={fence.name}
        style={{
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          textTransform: 'uppercase',
        }}
      >
        {fence.name}
      </span>
      <span style={{ color: 'var(--text-3)' }}>{RULE_ABBR[fence.rule]}</span>
      <button
        type="button"
        onClick={() => void setActive({ id: fence._id, active: !fence.active })}
        title={fence.active ? 'Deactivate fence' : 'Activate fence'}
        className="mono"
        style={{
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          fontSize: 9,
          letterSpacing: '0.1em',
          color: fence.active ? 'var(--ok)' : 'var(--text-3)',
        }}
      >
        {fence.active ? 'ON' : 'OFF'}
      </button>
      <button
        type="button"
        onClick={() => void remove({ id: fence._id })}
        title="Delete fence"
        aria-label={`Delete fence ${fence.name}`}
        style={{
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          color: 'var(--text-3)',
          fontSize: 11,
          lineHeight: 1,
        }}
      >
        ×
      </button>
    </div>
  );
}

export function FencePanel() {
  const fences = useQuery(api.geofences.list, {});
  const create = useMutation(api.geofences.create);
  const { drawing, points, start, cancel, finish } = useFenceDraw();

  const [name, setName] = useState('');
  const [rule, setRule] = useState<Rule>('enter');
  const [dwellSec, setDwellSec] = useState('600');
  const [kinds, setKinds] = useState<string[]>(['vessel', 'aircraft']);
  const [severity, setSeverity] = useState<Severity>('watch');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const dwellNum = Number(dwellSec);
  const dwellOk = rule !== 'dwell' || (Number.isFinite(dwellNum) && dwellNum > 0);
  const canFinish =
    points.length >= 3 && name.trim().length > 0 && kinds.length > 0 && dwellOk && !busy;

  const toggleKind = (k: string) =>
    setKinds((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));

  const onStart = () => {
    setErr(null);
    start();
  };

  const onCancel = () => {
    setErr(null);
    cancel();
  };

  const onFinish = () => {
    if (!canFinish) return;
    const out = finish(); // closes the ring and resets the draw state
    if (!out) return;
    setBusy(true);
    void create({
      name: name.trim(),
      geojson: out.geojson,
      rule,
      dwellSec: rule === 'dwell' ? dwellNum : undefined,
      entityKinds: kinds,
      severity,
    })
      .then(() => {
        setName('');
        setErr(null);
      })
      .catch(() => setErr('Could not save the fence. Try again.'))
      .finally(() => setBusy(false));
  };

  return (
    <div
      className="scanlines"
      style={{
        position: 'absolute',
        bottom: 56,
        left: 12,
        zIndex: 10,
        width: 190,
        background: 'rgba(13,17,23,0.92)',
        border: '1px solid var(--border-hairline)',
        backdropFilter: 'blur(4px)',
      }}
    >
      <div
        className="microlabel"
        style={{ padding: '7px 10px 3px', display: 'flex', justifyContent: 'space-between' }}
      >
        <span>FENCES{drawing ? ' · DRAWING' : ''}</span>
        {!drawing && <span>{fences?.length ?? ''}</span>}
      </div>

      {!drawing && (
        <>
          <div style={{ maxHeight: 168, overflowY: 'auto' }}>
            {fences !== undefined && fences.length === 0 && (
              <div
                className="mono"
                style={{ padding: '4px 10px', fontSize: 10, color: 'var(--text-3)' }}
              >
                No fences yet.
              </div>
            )}
            {(fences ?? []).map((f) => (
              <FenceRow key={f._id} fence={f} />
            ))}
          </div>
          <div style={{ padding: '6px 10px 8px' }}>
            <Btn onClick={onStart} accent>
              + New fence
            </Btn>
          </div>
        </>
      )}

      {drawing && (
        <div style={{ padding: '2px 10px 8px', display: 'grid', gap: 6 }}>
          <div className="mono" style={{ fontSize: 10, color: 'var(--text-2)', lineHeight: 1.4 }}>
            Click the map to add vertices. FINISH closes the ring.
          </div>
          <div className="mono" style={{ fontSize: 10, color: 'var(--intel)' }}>
            VERTICES {points.length}
            {points.length < 3 ? ' / 3 MIN' : ''}
          </div>

          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="fence name"
            aria-label="Fence name"
            style={inputStyle}
          />

          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span className="microlabel">RULE</span>
            <select
              value={rule}
              onChange={(e) => setRule(e.target.value as Rule)}
              aria-label="Fence rule"
              style={{ ...inputStyle, flex: 1, width: 'auto' }}
            >
              {RULES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>

          {rule === 'dwell' && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span className="microlabel">DWELL S</span>
              <input
                type="number"
                min={1}
                value={dwellSec}
                onChange={(e) => setDwellSec(e.target.value)}
                aria-label="Dwell seconds"
                style={{ ...inputStyle, flex: 1, width: 'auto' }}
              />
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 6px' }}>
            {ENTITY_KINDS.map((k) => (
              <label
                key={k}
                className="mono"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  fontSize: 10,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: kinds.includes(k) ? 'var(--text-1)' : 'var(--text-3)',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={kinds.includes(k)}
                  onChange={() => toggleKind(k)}
                  style={{ accentColor: 'var(--intel)', margin: 0, width: 11, height: 11 }}
                />
                {k}
              </label>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span className="microlabel">SEV</span>
            <select
              value={severity}
              onChange={(e) => setSeverity(e.target.value as Severity)}
              aria-label="Fence severity"
              style={{ ...inputStyle, flex: 1, width: 'auto' }}
            >
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          {err && (
            <div className="mono" style={{ fontSize: 10, color: 'var(--critical)' }}>
              {err}
            </div>
          )}

          <div style={{ display: 'flex', gap: 6 }}>
            <Btn onClick={onFinish} disabled={!canFinish} accent title="Close the ring and save">
              Finish
            </Btn>
            <Btn onClick={onCancel}>Cancel</Btn>
          </div>
        </div>
      )}
    </div>
  );
}
