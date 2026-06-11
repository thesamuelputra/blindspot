import type { ReactNode } from 'react';
import { useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { useNow } from '@/lib/time';
import { useUi } from '@/state/ui';

// Shared building blocks for the cluster page side panels: severity colored
// mono rows, stat chips, section headers, reading rows. All inline styles on
// the tokens.css vars; color carries meaning (BRIEF §12).

// ---- shapes (structural subsets of the Convex docs) ----

export interface FeedRow {
  _id: string;
  title: string;
  severity: string;
  sourceSlug: string;
  observedAt: number;
  lat?: number;
  lng?: number;
}

export interface ReadingDoc {
  _id: string;
  stationId: string;
  metric: string;
  value: number;
  unit: string;
  at: number;
  lat?: number;
  lng?: number;
  sourceSlug: string;
}

// ---- data hooks ----

export function useSignals(kinds: string[], sinceMs: number, limit?: number) {
  return useQuery(api.pageData.signalsByKinds, { kinds, sinceMs, limit });
}

export function useReadings(metrics: string[], limit?: number) {
  return useQuery(api.pageData.latestReadings, { metrics, limit });
}

// Row count of a positions:<kind> snapshot (null while loading / absent).
export function useSnapshotCount(key: string): number | null {
  const row = useQuery(api.snapshots.get, { key });
  if (!row) return null;
  try {
    const arr: unknown = JSON.parse(row.json);
    return Array.isArray(arr) ? arr.length : null;
  } catch {
    return null;
  }
}

// ---- formatting ----

export function ago(now: number, ts?: number): string {
  if (!ts) return 'n/a';
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 90) return `${s}s`;
  if (s < 5400) return `${Math.floor(s / 60)}m`;
  if (s < 172800) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function sevColor(severity?: string): string {
  if (severity === 'critical') return 'var(--critical)';
  if (severity === 'warning' || severity === 'watch') return 'var(--warn)';
  return 'var(--text-2)';
}

export function fmtValue(v: number): string {
  if (!Number.isFinite(v)) return 'n/a';
  if (v !== 0 && Math.abs(v) < 0.01) return v.toExponential(1);
  if (Math.abs(v) >= 1000) return Math.round(v).toLocaleString('en-CA');
  return String(Math.round(v * 10) / 10);
}

// Station ids are "<sourceSlug>:<upstream id>"; show the upstream part.
export function stationLabel(stationId: string): string {
  const i = stationId.indexOf(':');
  return i >= 0 ? stationId.slice(i + 1) : stationId;
}

// ---- panel chrome ----

export function PanelHeader({ code, note }: { code: string; note?: string }) {
  return (
    <header
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 1,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 12px',
        borderBottom: '1px solid var(--border-hairline)',
        background: 'rgba(13,17,23,0.96)',
      }}
    >
      <span className="microlabel" style={{ color: 'var(--accent-live)' }}>
        {code}
      </span>
      <div style={{ flex: 1 }} />
      {note && <span className="microlabel">{note}</span>}
    </header>
  );
}

export function ChipRow({ children }: { children: ReactNode }) {
  return <div style={{ display: 'flex', gap: 8, padding: '10px 12px 2px' }}>{children}</div>;
}

export function StatChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number | null | undefined;
  tone?: string;
}) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        border: '1px solid var(--border-hairline)',
        background: 'var(--bg-2)',
        padding: '6px 8px',
      }}
    >
      <div
        className="mono"
        style={{ fontSize: 17, fontWeight: 700, lineHeight: 1.2, color: tone ?? 'var(--text-1)' }}
      >
        {value ?? '…'}
      </div>
      <div className="microlabel" style={{ marginTop: 1 }}>
        {label}
      </div>
    </div>
  );
}

export function Section({
  label,
  count,
  children,
}: {
  label: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '12px 12px 4px' }}>
        <span className="microlabel" style={{ color: 'var(--text-2)' }}>
          {label}
        </span>
        {count !== undefined && (
          <span className="mono" style={{ fontSize: 10, color: 'var(--text-3)' }}>
            {count}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

export function Status({ text }: { text: string }) {
  return (
    <div className="mono" style={{ padding: '6px 12px', fontSize: 11, color: 'var(--text-3)' }}>
      {text}
    </div>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return (
    <p
      style={{
        margin: '4px 12px 8px',
        padding: '8px 10px',
        border: '1px solid var(--border-hairline)',
        background: 'var(--bg-2)',
        color: 'var(--text-2)',
        fontSize: 11,
        lineHeight: 1.5,
      }}
    >
      {children}
    </p>
  );
}

// ---- rows ----

// One feed row: severity dot, title, age + source. Rows with coordinates fly
// the map to the spot on click.
export function EventRow({
  title,
  at,
  source,
  severity,
  lat,
  lng,
}: {
  title: string;
  at: number;
  source: string;
  severity?: string;
  lat?: number;
  lng?: number;
}) {
  const now = useNow(5000);
  const requestFlyTo = useUi((s) => s.requestFlyTo);
  const hasPos = typeof lat === 'number' && typeof lng === 'number';
  const c = sevColor(severity);
  return (
    <button
      onClick={hasPos ? () => requestFlyTo({ lat: lat as number, lng: lng as number, zoom: 9 }) : undefined}
      disabled={!hasPos}
      className="mono"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        width: '100%',
        padding: '6px 12px',
        background: 'none',
        border: 'none',
        borderBottom: '1px solid var(--border-hairline)',
        cursor: hasPos ? 'pointer' : 'default',
        textAlign: 'left',
        color: 'var(--text-1)',
        fontSize: 11,
        lineHeight: 1.45,
      }}
      title={hasPos ? 'Jump to this spot on the map' : undefined}
    >
      <span
        className="dot"
        style={{ width: 6, height: 6, borderRadius: '50%', background: c, marginTop: 5, flexShrink: 0 }}
      />
      <span style={{ flex: 1, minWidth: 0 }}>
        {title}
        <span
          style={{
            display: 'block',
            color: 'var(--text-3)',
            fontSize: 10,
            letterSpacing: '0.08em',
            marginTop: 1,
          }}
        >
          {ago(now, at).toUpperCase()} · {source.toUpperCase()}
          {hasPos ? ' · MAP' : ''}
        </span>
      </span>
    </button>
  );
}

// Severity colored signal rows with loading and empty states handled.
export function SignalList({ rows, empty }: { rows: FeedRow[] | undefined; empty: string }) {
  if (rows === undefined) return <Status text="Syncing" />;
  if (rows.length === 0) return <Status text={empty} />;
  return (
    <div>
      {rows.map((r) => (
        <EventRow
          key={r._id}
          title={r.title}
          at={r.observedAt}
          source={r.sourceSlug}
          severity={r.severity}
          lat={r.lat}
          lng={r.lng}
        />
      ))}
    </div>
  );
}

// One reading row: station, value + unit, age. Flies to the station when the
// reading carries coordinates.
export function ReadingRow({ r, tone }: { r: ReadingDoc; tone?: string }) {
  const now = useNow(5000);
  const requestFlyTo = useUi((s) => s.requestFlyTo);
  const hasPos = typeof r.lat === 'number' && typeof r.lng === 'number';
  return (
    <button
      onClick={
        hasPos ? () => requestFlyTo({ lat: r.lat as number, lng: r.lng as number, zoom: 10 }) : undefined
      }
      disabled={!hasPos}
      className="mono"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: '100%',
        padding: '5px 12px',
        background: 'none',
        border: 'none',
        borderBottom: '1px solid var(--border-hairline)',
        cursor: hasPos ? 'pointer' : 'default',
        textAlign: 'left',
        color: 'var(--text-2)',
        fontSize: 11,
      }}
      title={hasPos ? 'Jump to this station on the map' : undefined}
    >
      <span
        style={{
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {stationLabel(r.stationId)}
      </span>
      <span style={{ color: tone ?? 'var(--text-1)', fontWeight: 600 }}>
        {fmtValue(r.value)}
        <span style={{ color: 'var(--text-3)', fontWeight: 400, marginLeft: 3 }}>{r.unit}</span>
      </span>
      <span style={{ color: 'var(--text-3)', width: 32, textAlign: 'right', flexShrink: 0 }}>
        {ago(now, r.at)}
      </span>
    </button>
  );
}

// Big mono gauge (SPACE page readouts).
export function Gauge({
  label,
  value,
  unit,
  at,
  tone,
}: {
  label: string;
  value: string | null;
  unit?: string;
  at?: number;
  tone?: string;
}) {
  const now = useNow(5000);
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        border: '1px solid var(--border-hairline)',
        background: 'var(--bg-2)',
        padding: '10px 12px',
      }}
    >
      <div className="microlabel">{label}</div>
      <div
        className="mono"
        style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.25, color: tone ?? 'var(--text-1)' }}
      >
        {value ?? '…'}
        {value !== null && unit && (
          <span style={{ fontSize: 11, color: 'var(--text-3)', marginLeft: 4 }}>{unit}</span>
        )}
      </div>
      <div className="mono" style={{ fontSize: 10, color: 'var(--text-3)' }}>
        {at ? `${ago(now, at).toUpperCase()} AGO` : 'NO DATA YET'}
      </div>
    </div>
  );
}

// Latest reading for a metric across whatever stations report it.
export function latestOf(rows: ReadingDoc[] | undefined, metric: string): ReadingDoc | undefined {
  if (!rows) return undefined;
  let best: ReadingDoc | undefined;
  for (const r of rows) {
    if (r.metric === metric && (!best || r.at > best.at)) best = r;
  }
  return best;
}

export const HOUR = 3600_000;
