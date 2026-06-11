import { useMemo, useState } from 'react';
import { useQuery } from 'convex/react';
import type { FunctionReturnType } from 'convex/server';
import { api } from '../../convex/_generated/api';
import { useNow } from '@/lib/time';

// SYSTEM ops board (BRIEF §4 page 14, §8.10): stat tiles, the regional threat
// panel, and the FEED HEALTH table as the centerpiece. Provenance is what
// separates intel from vibes; this page is where every feed answers for itself.

type Overview = NonNullable<FunctionReturnType<typeof api.systemStats.overview>>;
type SourceRow = Overview['sources'][number];
type Status = SourceRow['status'];

const STATUS_META: Record<Status, { weight: number; color: string; label: string }> = {
  down: { weight: 0, color: 'var(--critical)', label: 'DOWN' },
  stale: { weight: 1, color: 'var(--warn)', label: 'STALE' },
  live: { weight: 2, color: 'var(--ok)', label: 'LIVE' },
  disabled: { weight: 3, color: 'var(--text-3)', label: 'OFF' },
};

const THREAT_COLOR: Record<'NOMINAL' | 'ELEVATED' | 'HIGH', string> = {
  NOMINAL: 'var(--ok)',
  ELEVATED: 'var(--warn)',
  HIGH: 'var(--critical)',
};

// A source can stop syncing without ever reporting a failure (dead cron, dead
// worker). Surface that honestly: live + no sync inside 3x cadence reads as
// stale on the board. Floor of 5 min so fast worker lanes do not flap.
function effectiveStatus(s: SourceRow, now: number): Status {
  if (
    s.status === 'live' &&
    s.lastSyncAt !== undefined &&
    now - s.lastSyncAt > Math.max(s.cadenceSec * 3000, 300_000)
  ) {
    return 'stale';
  }
  return s.status;
}

function ago(now: number, ts: number | undefined | null): string {
  if (!ts) return 'never';
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 90) return `${s}s`;
  if (s < 5400) return `${Math.floor(s / 60)}m`;
  if (s < 172800) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function cadence(sec: number): string {
  if (sec >= 86400) return `${Math.round(sec / 86400)}d`;
  if (sec >= 3600) return `${Math.round(sec / 3600)}h`;
  if (sec >= 120) return `${Math.round(sec / 60)}m`;
  return `${sec}s`;
}

const PULSE_CSS = `
@keyframes sysLivePulse {
  0% { box-shadow: 0 0 0 0 rgba(52, 211, 153, 0.45); }
  70% { box-shadow: 0 0 0 5px rgba(52, 211, 153, 0); }
  100% { box-shadow: 0 0 0 0 rgba(52, 211, 153, 0); }
}
.sys-dot-live { animation: sysLivePulse 2.4s var(--ease-ops) infinite; }
.sys-row:hover { background: var(--bg-2); }
`;

export function SystemPage() {
  const overview = useQuery(api.systemStats.overview, {});
  const now = useNow(1000);
  const [sortMode, setSortMode] = useState<'status' | 'az'>('status');
  const [expandedError, setExpandedError] = useState<string | null>(null);

  const sources = useMemo(() => overview?.sources ?? [], [overview]);

  // group by cluster; default order is worst status first, then cluster name
  const groups = useMemo(() => {
    const byCluster = new Map<string, Array<{ row: SourceRow; st: Status }>>();
    for (const row of sources) {
      const st = effectiveStatus(row, now);
      const list = byCluster.get(row.cluster) ?? [];
      list.push({ row, st });
      byCluster.set(row.cluster, list);
    }
    const out = [...byCluster.entries()].map(([cluster, rows]) => {
      rows.sort((a, b) =>
        sortMode === 'status'
          ? STATUS_META[a.st].weight - STATUS_META[b.st].weight ||
            a.row.slug.localeCompare(b.row.slug)
          : a.row.slug.localeCompare(b.row.slug),
      );
      const worst = Math.min(...rows.map((r) => STATUS_META[r.st].weight));
      const degraded = rows.filter((r) => r.st === 'stale' || r.st === 'down').length;
      return { cluster, rows, worst, degraded };
    });
    out.sort((a, b) =>
      sortMode === 'status'
        ? a.worst - b.worst || a.cluster.localeCompare(b.cluster)
        : a.cluster.localeCompare(b.cluster),
    );
    return out;
  }, [sources, sortMode, now]);

  const statusCounts = useMemo(() => {
    const c: Record<Status, number> = { live: 0, stale: 0, down: 0, disabled: 0 };
    for (const g of groups) for (const r of g.rows) c[r.st]++;
    return c;
  }, [groups]);

  const attributions = useMemo(
    () => [...new Set(sources.map((s) => s.attribution))].sort(),
    [sources],
  );

  if (overview === undefined) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span className="microlabel">LOADING OPS BOARD…</span>
      </div>
    );
  }
  if (overview === null) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span className="microlabel">SESSION REQUIRED</span>
      </div>
    );
  }

  const { counts, threat, intsumAt } = overview;
  const entitiesTotal = Object.values(counts.entities).reduce((a, b) => a + b, 0);
  const entitiesBreakdown = Object.entries(counts.entities)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');

  return (
    <div style={{ position: 'absolute', inset: 0, overflowY: 'auto', background: 'var(--bg-0)' }}>
      <style>{PULSE_CSS}</style>
      <div
        style={{
          padding: 'var(--s4)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--s4)',
          minHeight: '100%',
        }}
      >
        <header style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--s3)', flexWrap: 'wrap' }}>
          <span className="mono" style={{ fontSize: 14, fontWeight: 700, letterSpacing: '0.14em' }}>
            SYSTEM
          </span>
          <span className="microlabel">FEED HEALTH · THREAT · PROVENANCE</span>
          <div style={{ flex: 1 }} />
          <span className="mono" style={{ color: 'var(--text-3)', fontSize: 11 }}>
            {sources.length} FEEDS REGISTERED
          </span>
        </header>

        {/* stat tiles */}
        <div style={{ display: 'flex', gap: 'var(--s2)', flexWrap: 'wrap' }}>
          <Tile label="FEEDS LIVE" value={statusCounts.live} tone="var(--ok)" />
          <Tile
            label="STALE"
            value={statusCounts.stale}
            tone={statusCounts.stale > 0 ? 'var(--warn)' : 'var(--text-3)'}
          />
          <Tile
            label="DOWN"
            value={statusCounts.down}
            tone={statusCounts.down > 0 ? 'var(--critical)' : 'var(--text-3)'}
          />
          <Tile
            label="ACTIVE ALERTS"
            value={counts.alertsActive}
            tone={counts.alertsActive > 0 ? 'var(--warn)' : 'var(--text-3)'}
          />
          <Tile
            label="UNACKED NOTIFS"
            value={`${counts.notificationsUnacked}${counts.notificationsCapped ? '+' : ''}`}
            tone={counts.notificationsUnacked > 0 ? 'var(--warn)' : 'var(--text-3)'}
          />
          <Tile
            label="ENTITIES TRACKED"
            value={entitiesTotal}
            tone="var(--accent-live)"
            title={entitiesBreakdown || 'no position snapshots yet'}
          />
          <Tile
            label="LAST INTSUM"
            value={intsumAt ? `${ago(now, intsumAt)} ago` : 'none'}
            tone={intsumAt ? 'var(--intel)' : 'var(--text-3)'}
          />
        </div>

        <div style={{ display: 'flex', gap: 'var(--s4)', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          {/* feed health — the centerpiece */}
          <section
            style={{
              flex: '1 1 560px',
              minWidth: 0,
              background: 'var(--bg-1)',
              border: '1px solid var(--border-hairline)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--s3)',
                padding: '8px 12px',
                borderBottom: '1px solid var(--border-hairline)',
              }}
            >
              <span className="microlabel" style={{ color: 'var(--accent-live)' }}>
                FEED HEALTH
              </span>
              <div style={{ flex: 1 }} />
              <span className="microlabel">SORT</span>
              <SortButton active={sortMode === 'status'} onClick={() => setSortMode('status')}>
                STATUS
              </SortButton>
              <SortButton active={sortMode === 'az'} onClick={() => setSortMode('az')}>
                A TO Z
              </SortButton>
            </div>

            {/* On narrow viewports the grid scrolls sideways instead of
                silently clipping columns; minWidth keeps every column real. */}
            <div style={{ overflowX: 'auto' }}>
            <div style={{ minWidth: 600 }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '14px minmax(150px, 1.1fr) 58px 76px 56px minmax(140px, 1.6fr)',
                gap: '0 var(--s3)',
                alignItems: 'center',
                padding: '6px 12px',
                borderBottom: '1px solid var(--border-hairline)',
              }}
            >
              <span />
              <span className="microlabel">FEED</span>
              <span className="microlabel">CADENCE</span>
              <span className="microlabel">LAST SYNC</span>
              <span className="microlabel" style={{ textAlign: 'right' }}>
                COUNT
              </span>
              <span className="microlabel">LAST ERROR</span>
            </div>

            {groups.length === 0 && (
              <div style={{ padding: '20px 12px' }}>
                <span className="mono" style={{ color: 'var(--text-3)' }}>
                  No feeds registered yet. Each feed writes its own health row on first sync.
                </span>
              </div>
            )}

            {groups.map((g) => (
              <div key={g.cluster}>
                <div
                  style={{
                    padding: '7px 12px 4px',
                    borderBottom: '1px solid var(--border-hairline)',
                    background: 'var(--bg-2)',
                  }}
                >
                  <span className="microlabel" style={{ color: 'var(--text-2)' }}>
                    {g.cluster.toUpperCase()} · {g.rows.length}{' '}
                    {g.rows.length === 1 ? 'FEED' : 'FEEDS'}
                    {g.degraded > 0 && (
                      <span style={{ color: 'var(--warn)' }}> · {g.degraded} DEGRADED</span>
                    )}
                  </span>
                </div>
                {g.rows.map(({ row, st }) => {
                  const meta = STATUS_META[st];
                  const expanded = expandedError === row.slug;
                  return (
                    <div
                      key={row.slug}
                      className="sys-row"
                      style={{
                        display: 'grid',
                        gridTemplateColumns:
                          '14px minmax(150px, 1.1fr) 58px 76px 56px minmax(140px, 1.6fr)',
                        gap: '0 var(--s3)',
                        alignItems: 'center',
                        padding: '5px 12px',
                        borderBottom: '1px solid var(--border-hairline)',
                      }}
                    >
                      <span
                        className={st === 'live' ? 'sys-dot-live' : undefined}
                        title={meta.label}
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: '50%',
                          background: meta.color,
                          opacity: st === 'disabled' ? 0.5 : 1,
                        }}
                      />
                      <span
                        className="mono"
                        title={`${row.name} (${meta.label.toLowerCase()})`}
                        style={{
                          color: st === 'disabled' ? 'var(--text-3)' : 'var(--text-1)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {row.slug}
                      </span>
                      <span className="mono" style={{ color: 'var(--text-3)' }}>
                        {cadence(row.cadenceSec)}
                      </span>
                      <span
                        className="mono"
                        style={{ color: st === 'live' ? 'var(--text-2)' : meta.color }}
                      >
                        {ago(now, row.lastSyncAt)}
                      </span>
                      <span className="mono" style={{ color: 'var(--text-2)', textAlign: 'right' }}>
                        {row.lastCount ?? '·'}
                      </span>
                      {row.lastError ? (
                        <span
                          className="mono"
                          title={row.lastError}
                          onClick={() => setExpandedError(expanded ? null : row.slug)}
                          style={{
                            color: 'var(--warn)',
                            fontSize: 11,
                            cursor: 'pointer',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: expanded ? 'normal' : 'nowrap',
                            wordBreak: expanded ? 'break-word' : undefined,
                          }}
                        >
                          {row.lastError}
                        </span>
                      ) : (
                        <span className="mono" style={{ color: 'var(--text-3)' }}>
                          ·
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
            </div>
            </div>
          </section>

          {/* regional threat */}
          <aside
            style={{
              flex: '0 1 300px',
              minWidth: 260,
              background: 'var(--bg-1)',
              border: '1px solid var(--border-hairline)',
            }}
          >
            <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-hairline)' }}>
              <span className="microlabel" style={{ color: 'var(--accent-live)' }}>
                REGIONAL THREAT
              </span>
              {threat && (
                <span className="mono" style={{ color: 'var(--text-3)', fontSize: 10, float: 'right' }}>
                  COMPUTED {ago(now, threat.computedAt)} AGO
                </span>
              )}
            </div>
            <div style={{ padding: 12 }}>
              {threat ? (
                <>
                  <div
                    className="mono"
                    style={{
                      fontSize: 28,
                      fontWeight: 700,
                      letterSpacing: '0.1em',
                      color: THREAT_COLOR[threat.level],
                    }}
                  >
                    {threat.level}
                  </div>
                  <div className="mono" style={{ color: 'var(--text-2)', marginTop: 2 }}>
                    SCORE {threat.score.toFixed(2)}
                  </div>
                  <div className="microlabel" style={{ margin: '12px 0 6px' }}>
                    CONTRIBUTING FACTORS
                  </div>
                  {threat.factors.length === 0 && (
                    <span className="mono" style={{ color: 'var(--text-3)' }}>
                      none active
                    </span>
                  )}
                  {threat.factors.map((f, i) => {
                    const max = Math.max(...threat.factors.map((x) => x.weight), 0.001);
                    return (
                      <div key={`${f.label}-${i}`} style={{ padding: '3px 0' }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                          <span
                            className="mono"
                            style={{
                              flex: 1,
                              minWidth: 0,
                              fontSize: 11,
                              color: 'var(--text-2)',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                            title={f.label}
                          >
                            {f.label}
                          </span>
                          <span className="mono" style={{ color: 'var(--text-1)', fontSize: 11 }}>
                            {f.weight.toFixed(2)}
                          </span>
                        </div>
                        <div style={{ height: 2, background: 'var(--bg-3)', marginTop: 2 }}>
                          <div
                            style={{
                              height: 2,
                              width: `${Math.min(100, (f.weight / max) * 100)}%`,
                              background: THREAT_COLOR[threat.level],
                              opacity: 0.7,
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                  <div className="microlabel" style={{ marginTop: 12, lineHeight: 1.6 }}>
                    HEURISTIC: ACTIVE HAZARDS WEIGHTED BY SEVERITY, PROXIMITY, RECENCY
                  </div>
                </>
              ) : (
                <span className="mono" style={{ color: 'var(--text-3)' }}>
                  No threat compute yet. The brain writes one about every 15 minutes.
                </span>
              )}
            </div>
          </aside>
        </div>

        {/* footer: provenance + disclaimer */}
        <footer
          style={{
            marginTop: 'auto',
            borderTop: '1px solid var(--border-hairline)',
            paddingTop: 'var(--s3)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--s1)',
          }}
        >
          <span style={{ color: 'var(--text-3)', fontSize: 11, lineHeight: 1.6 }}>
            Data credits: {attributions.length > 0 ? attributions.join(' · ') : 'pending first sync'}
          </span>
          <span className="microlabel">
            AGGREGATED PUBLIC OSINT · INFORMATIONAL ONLY · NOT FOR LIFE SAFETY DECISIONS
          </span>
        </footer>
      </div>
    </div>
  );
}

function Tile({
  label,
  value,
  tone,
  title,
}: {
  label: string;
  value: string | number;
  tone: string;
  title?: string;
}) {
  return (
    <div
      title={title}
      style={{
        background: 'var(--bg-1)',
        border: '1px solid var(--border-hairline)',
        padding: '8px 14px',
        minWidth: 104,
      }}
    >
      <div className="mono" style={{ fontSize: 20, fontWeight: 700, color: tone }}>
        {value}
      </div>
      <div className="microlabel" style={{ marginTop: 2 }}>
        {label}
      </div>
    </div>
  );
}

function SortButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      onClick={onClick}
      className="mono"
      style={{
        background: active ? 'var(--bg-3)' : 'none',
        border: '1px solid var(--border-hairline)',
        color: active ? 'var(--text-1)' : 'var(--text-3)',
        cursor: 'pointer',
        fontSize: 10,
        letterSpacing: '0.1em',
        padding: '2px 8px',
      }}
    >
      {children}
    </button>
  );
}
