import { motion } from 'motion/react';
import { useNow } from '@/lib/time';
import { LiveMedia } from '@/components/media/LiveMedia';
import { AddToIncident } from '@/components/incidents/AddToIncident';
import { WatchToggle } from '@/components/watch/WatchToggle';
import { PatternOfLife } from '@/components/watch/PatternOfLife';
import { AircraftEnrichmentPanel, FerryEnrichmentPanel, BusStopsPanel } from './Enrichment';
import type { InspectTarget } from '@/state/ui';

// INSPECTOR (ARCHITECTURE §10 interaction contract): click = the thing itself.
// Movers: identity + state + live fix age (true age — extrapolation is
// presentation only); cameras: the live feed; signals: the facts.

interface TrailPayload {
  entity: {
    label: string;
    lat: number;
    lng: number;
    heading?: number;
    speed?: number;
    altitude?: number;
    state?: string;
    firstSeenAt: number;
    lastSeenAt: number;
    stale: boolean;
  };
  points: Array<{ lat: number; lng: number; at: number }>;
}

export function Inspector({
  target,
  trail,
  onClose,
}: {
  target: InspectTarget;
  trail: TrailPayload | null;
  onClose: () => void;
}) {
  return (
    <motion.aside
      initial={{ x: 24, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      className="scanlines"
      style={{
        position: 'absolute',
        top: 12,
        right: 12,
        bottom: 12,
        width: 320,
        zIndex: 20,
        background: 'rgba(13,17,23,0.96)',
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
          padding: '8px 12px',
          borderBottom: '1px solid var(--border-hairline)',
          gap: 8,
        }}
      >
        <span className="microlabel" style={{ color: 'var(--accent-live)' }}>
          INSPECTOR
        </span>
        <div style={{ flex: 1 }} />
        <button
          onClick={onClose}
          className="mono"
          style={{
            background: 'none',
            border: '1px solid var(--border-hairline)',
            color: 'var(--text-2)',
            cursor: 'pointer',
            fontSize: 11,
            padding: '1px 7px',
          }}
        >
          ×
        </button>
      </header>
      <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
        {target.type === 'mover' && <MoverPanel target={target} trail={trail} />}
        {target.type === 'camera' && <CameraPanel target={target} />}
        {target.type === 'signal' && <SignalPanel data={target.data} />}
      </div>
    </motion.aside>
  );
}

function Row({ k, v }: { k: string; v: string | number | undefined | null }) {
  if (v === undefined || v === null || v === '') return null;
  return (
    <div style={{ display: 'flex', gap: 8, padding: '3px 0', borderBottom: '1px solid var(--border-hairline)' }}>
      <span className="microlabel" style={{ width: 92, flexShrink: 0, paddingTop: 2 }}>
        {k}
      </span>
      <span className="mono" style={{ color: 'var(--text-1)', wordBreak: 'break-word' }}>
        {String(v)}
      </span>
    </div>
  );
}

function ago(now: number, ts?: number): string {
  if (!ts) return '—';
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function MoverPanel({
  target,
  trail,
}: {
  target: Extract<InspectTarget, { type: 'mover' }>;
  trail: TrailPayload | null;
}) {
  const now = useNow(1000);
  const e = trail?.entity;
  let state: Record<string, unknown> = {};
  try {
    state = e?.state ? (JSON.parse(e.state) as Record<string, unknown>) : {};
  } catch {
    /* keep empty */
  }
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div className="mono" style={{ fontSize: 15, fontWeight: 700, letterSpacing: '0.06em', flex: 1 }}>
          {target.label}
        </div>
        <WatchToggle kind={target.kind} extId={target.extId} label={target.label} />
      </div>
      <div className="microlabel" style={{ margin: '2px 0 10px' }}>
        {target.kind.toUpperCase()} · {target.extId}
        {e?.stale ? ' · STALE' : ''}
      </div>
      {target.kind === 'aircraft' && (
        <AircraftEnrichmentPanel
          hex={target.extId}
          callsign={target.label}
          lat={e?.lat}
          lng={e?.lng}
        />
      )}
      {target.kind === 'ferry' && (
        <FerryEnrichmentPanel extId={target.extId} route={state.route as string | undefined} />
      )}
      {target.kind === 'bus' && <BusStopsPanel routeId={state.routeId as string | undefined} />}
      <Row k="LAST FIX" v={e ? ago(now, e.lastSeenAt) : 'loading…'} />
      <Row k="SPEED" v={e?.speed !== undefined ? `${Math.round(e.speed)} kt` : undefined} />
      <Row k="HEADING" v={e?.heading !== undefined ? `${Math.round(e.heading)}°` : undefined} />
      <Row k="ALTITUDE" v={e?.altitude !== undefined ? `${e.altitude} ft` : undefined} />
      {Object.entries(state).map(([k, v]) =>
        v === null || v === undefined || v === false || v === '' ? null : (
          <Row key={k} k={k.toUpperCase()} v={typeof v === 'object' ? JSON.stringify(v) : String(v)} />
        ),
      )}
      <Row k="FIRST SEEN" v={e ? ago(now, e.firstSeenAt) : undefined} />
      <div className="microlabel" style={{ marginTop: 12 }}>
        PATH · LAST 12H · {trail?.points.length ?? 0} FIXES (violet trail on map)
      </div>
      <PatternOfLife kind={target.kind} extId={target.extId} />
    </div>
  );
}

function CameraPanel({ target }: { target: Extract<InspectTarget, { type: 'camera' }> }) {
  const cam = target.camera;
  return (
    <div>
      <div className="mono" style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
        {cam.name}
      </div>
      <LiveMedia camera={cam} />
      <div style={{ marginTop: 8 }}>
        <Row k="KIND" v={cam.kind.toUpperCase()} />
        <Row
          k="POSITION"
          v={
            cam.approxKm
              ? `~${cam.lat.toFixed(3)}, ${cam.lng.toFixed(3)} (est. ±${cam.approxKm} km)`
              : `${cam.lat.toFixed(4)}, ${cam.lng.toFixed(4)}`
          }
        />
        <Row k="CREDIT" v={cam.attribution} />
      </div>
    </div>
  );
}

function SignalPanel({ data }: { data: Record<string, unknown> }) {
  const now = useNow(5000);
  const title = (data.title ?? data.headline ?? 'SIGNAL') as string;
  const severity = data.severity as string | undefined;
  const sevColor =
    severity === 'critical'
      ? 'var(--critical)'
      : severity === 'warning' || severity === 'watch'
        ? 'var(--warn)'
        : 'var(--text-2)';
  let provenance: { url?: string } = {};
  try {
    provenance = data.provenance ? (JSON.parse(data.provenance as string) as { url?: string }) : {};
  } catch {
    /* none */
  }
  return (
    <div>
      <div className="mono" style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.4 }}>
        {title}
      </div>
      {severity && (
        <span className="pill" style={{ color: sevColor, margin: '6px 0 10px', display: 'inline-flex' }}>
          <span className="dot" style={{ background: sevColor }} />
          {severity}
        </span>
      )}
      {(data.summary ?? data.description) != null && (
        <p style={{ color: 'var(--text-2)', fontSize: 12, lineHeight: 1.5 }}>
          {String(data.summary ?? data.description)}
        </p>
      )}
      {data.rationale != null && (
        <>
          <div className="microlabel">RATIONALE</div>
          <p style={{ color: 'var(--text-2)', fontSize: 12 }}>{String(data.rationale)}</p>
        </>
      )}
      <Row k="SOURCE" v={data.sourceSlug as string} />
      <Row k="OBSERVED" v={data.observedAt ? ago(now, data.observedAt as number) : undefined} />
      <Row k="CONFIDENCE" v={data.confidence !== undefined ? String(data.confidence) : undefined} />
      {provenance.url && (
        <a
          href={provenance.url}
          target="_blank"
          rel="noreferrer"
          className="microlabel"
          style={{ display: 'inline-block', marginTop: 10, color: 'var(--text-3)' }}
        >
          open source ↗
        </a>
      )}
      {typeof data._id === 'string' && <AddToIncident signalId={data._id} />}
    </div>
  );
}
