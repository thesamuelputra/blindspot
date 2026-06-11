import { useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import { useUi } from '@/state/ui';
import { useNow, formatCoord } from '@/lib/time';
import type { PatternJson } from '../../../convex/brain/patternOfLife';

// Pattern-of-life readout for the Inspector mover panel (ARCHITECTURE §7.10).
// Renders the rolling profile folded daily onto the watchlist row: dwell
// sites with fly-to, a 24-bucket UTC activity strip, corridor and sighting
// counters. Profiles outlive 48h track retention by incremental folding.

function safeParse(json: string | undefined): PatternJson | null {
  if (!json) return null;
  try {
    const p = JSON.parse(json) as PatternJson;
    if (!Array.isArray(p.activeHoursUtc) || p.activeHoursUtc.length !== 24) return null;
    return p;
  } catch {
    return null;
  }
}

function ago(now: number, ts: number): string {
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.floor(s / 60)}m ago`;
  if (s < 172800) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function PatternOfLife({ kind, extId }: { kind: string; extId: string }) {
  const row = useQuery(api.watchlist.forIdent, { kind, identifier: extId });
  const requestFlyTo = useUi((s) => s.requestFlyTo);
  const now = useNow(30_000);

  if (!row) return null; // loading, or not on the watchlist

  const pattern = safeParse(row.pattern);

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span className="microlabel" style={{ color: 'var(--warn)' }}>
          PATTERN OF LIFE
        </span>
        <div style={{ flex: 1 }} />
        {pattern && (
          <span className="microlabel">{ago(now, pattern.updatedAt)}</span>
        )}
      </div>

      {!pattern || pattern.lastFoldedAt === 0 ? (
        <div className="mono" style={{ color: 'var(--text-3)', padding: '8px 0', fontSize: 11 }}>
          No profile yet, computed daily
        </div>
      ) : (
        <>
          {pattern.dwellSites.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div className="microlabel" style={{ marginBottom: 2 }}>
                DWELL SITES
              </div>
              {pattern.dwellSites.slice(0, 5).map((d, i) => (
                <div
                  key={d.key}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '3px 0',
                    borderBottom: '1px solid var(--border-hairline)',
                  }}
                >
                  <span className="mono" style={{ color: 'var(--text-3)', width: 12 }}>
                    {i + 1}
                  </span>
                  <span className="mono" style={{ color: 'var(--text-1)', fontSize: 11 }}>
                    {formatCoord(d.lat, d.lng)}
                  </span>
                  <span className="mono" style={{ color: 'var(--text-2)', fontSize: 11 }}>
                    ×{d.visits}
                  </span>
                  <div style={{ flex: 1 }} />
                  <button
                    type="button"
                    onClick={() => requestFlyTo({ lat: d.lat, lng: d.lng, zoom: 12.5 })}
                    className="mono"
                    title="Fly to this site"
                    style={{
                      background: 'none',
                      border: '1px solid var(--border-hairline)',
                      color: 'var(--accent-live)',
                      cursor: 'pointer',
                      fontSize: 10,
                      padding: '0 6px',
                      letterSpacing: '0.08em',
                    }}
                  >
                    view
                  </button>
                </div>
              ))}
            </div>
          )}

          <div style={{ marginTop: 10 }}>
            <div className="microlabel" style={{ marginBottom: 4 }}>
              ACTIVE HOURS UTC
            </div>
            <HourStrip hours={pattern.activeHoursUtc} />
          </div>

          <KV k="CORRIDORS" v={`${pattern.corridors.length} on file`} />
          <KV k="SIGHTINGS 30D" v={`${pattern.sightingsLast30d} day${pattern.sightingsLast30d === 1 ? '' : 's'}`} />
        </>
      )}
    </div>
  );
}

// 24 thin bars, normalized to the busiest hour. Divs only, no chart lib.
function HourStrip({ hours }: { hours: number[] }) {
  const max = Math.max(1, ...hours);
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 22 }}>
        {hours.map((h, i) => (
          <div
            key={i}
            title={`${String(i).padStart(2, '0')}:00 UTC, ${h} active hour${h === 1 ? '' : 's'}`}
            style={{
              flex: 1,
              minWidth: 2,
              height: h > 0 ? Math.max(3, Math.round((h / max) * 22)) : 2,
              background: h > 0 ? 'var(--accent-live)' : 'var(--border-hairline-strong)',
              opacity: h > 0 ? 0.35 + 0.65 * (h / max) : 1,
            }}
          />
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
        <span className="microlabel">00</span>
        <span className="microlabel">06</span>
        <span className="microlabel">12</span>
        <span className="microlabel">18</span>
        <span className="microlabel">23</span>
      </div>
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 8,
        padding: '3px 0',
        borderBottom: '1px solid var(--border-hairline)',
        marginTop: 2,
      }}
    >
      <span className="microlabel" style={{ width: 92, flexShrink: 0, paddingTop: 2 }}>
        {k}
      </span>
      <span className="mono" style={{ color: 'var(--text-1)' }}>
        {v}
      </span>
    </div>
  );
}
