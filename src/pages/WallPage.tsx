import { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { MapView } from '@/map/MapView';
import { StatTiles } from '@/components/command/StatTiles';
import { Ticker } from '@/components/command/Ticker';
import { useNow, formatUtc, formatLocal } from '@/lib/time';

const DWELL_MS = 25_000;
const VIEWS = ['map', 'board'] as const;

const THREAT_TONE: Record<string, string> = {
  NOMINAL: 'var(--ok)',
  ELEVATED: 'var(--warn)',
  HIGH: 'var(--critical)',
};

// WALL — chrome-less kiosk big-board, auto-rotating (BRIEF §4 page 15, §8.9).
// ESC exits back to COMMAND. Rotation pauses under prefers-reduced-motion.
export function WallPage() {
  const [view, setView] = useState<(typeof VIEWS)[number]>('map');
  const navigate = useNavigate();
  const now = useNow(1000);

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;
    const id = setInterval(
      () => setView((v) => VIEWS[(VIEWS.indexOf(v) + 1) % VIEWS.length]),
      DWELL_MS,
    );
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') void navigate({ to: '/command' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'var(--bg-0)' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          height: 44,
          padding: '0 16px',
          borderBottom: '1px solid var(--border-hairline)',
        }}
      >
        <span className="mono" style={{ fontWeight: 700, letterSpacing: '0.2em', fontSize: 15 }}>
          BLINDSPOT WALL
        </span>
        <span className="microlabel">{view === 'map' ? 'OPERATING PICTURE' : 'THREAT BOARD'}</span>
        <div style={{ flex: 1 }} />
        <span className="mono" style={{ fontSize: 14 }}>
          {formatLocal(now)} <span style={{ color: 'var(--text-3)' }}>LOC</span> · {formatUtc(now)}
        </span>
        <span className="microlabel">ESC EXITS</span>
      </header>
      <div style={{ position: 'absolute', top: 44, left: 0, right: 0, bottom: 0 }}>
        {view === 'map' ? (
          <>
            <MapView page="command" />
            <StatTiles />
            <Ticker />
          </>
        ) : (
          <ThreatBoard />
        )}
      </div>
    </div>
  );
}

function ThreatBoard() {
  const threat = useQuery(api.threat.latest, {});
  const intsum = useQuery(api.intsums.latest, {});
  const alerts = useQuery(api.alerts.active, {}) ?? [];
  const level = threat?.level ?? 'NOMINAL';
  // convex/threat.ts latest() returns factors already parsed
  const factors: Array<{ label: string; weight: number }> = threat?.factors ?? [];

  return (
    <div style={{ display: 'flex', height: '100%', padding: 32, gap: 32 }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div>
          <div className="microlabel" style={{ fontSize: 13 }}>
            REGIONAL THREAT LEVEL
          </div>
          <div
            className="mono"
            style={{ fontSize: 96, fontWeight: 700, letterSpacing: '0.06em', color: THREAT_TONE[level], lineHeight: 1.1 }}
          >
            {level}
          </div>
        </div>
        <div>
          <div className="microlabel" style={{ marginBottom: 8 }}>
            CONTRIBUTING FACTORS
          </div>
          {factors.length === 0 && (
            <div className="mono" style={{ color: 'var(--text-3)' }}>
              no active contributors
            </div>
          )}
          {factors.slice(0, 8).map((f, i) => (
            <div key={i} className="mono" style={{ fontSize: 14, padding: '4px 0', color: 'var(--text-2)' }}>
              {f.label} <span style={{ color: 'var(--text-3)' }}>+{f.weight.toFixed(1)}</span>
            </div>
          ))}
        </div>
        <div>
          <div className="microlabel" style={{ marginBottom: 8 }}>
            ACTIVE ALERTS · {alerts.length}
          </div>
          {alerts.slice(0, 6).map((a) => (
            <div key={a._id} className="mono" style={{ fontSize: 14, padding: '4px 0', color: a.severity === 'critical' ? 'var(--critical)' : 'var(--warn)' }}>
              {a.headline}
            </div>
          ))}
        </div>
      </div>
      <div style={{ width: '42%' }}>
        <div className="microlabel" style={{ marginBottom: 8 }}>
          LATEST INTSUM {intsum ? formatUtc(intsum.at) : ''}
        </div>
        <div className="mono" style={{ fontSize: 15, lineHeight: 1.8, whiteSpace: 'pre-wrap', color: 'var(--text-1)' }}>
          {intsum?.text ?? 'No INTSUM generated yet.'}
        </div>
      </div>
    </div>
  );
}
