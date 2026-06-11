import { useMemo, useState } from 'react';
import { useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import type { Doc } from '../../convex/_generated/dataModel';
import { CamTile } from '@/components/cams/CamTile';
import { usePinnedCams } from '@/components/cams/usePinnedCams';

type Camera = Doc<'cameras'>;

// CAMS flagship page (BRIEF §6): the cam wall. Control strip on top
// (kind chips, text filter, live count), pinned row, then the full grid.
// Tiles gate their own cost — see CamTile.

type ChipId = 'all' | 'road' | 'harbour' | 'audio' | 'live';

const CHIPS: Array<{ id: ChipId; label: string }> = [
  { id: 'all', label: 'ALL' },
  { id: 'road', label: 'ROAD' },
  { id: 'harbour', label: 'HARBOUR' },
  { id: 'audio', label: 'AUDIO' },
  { id: 'live', label: 'LIVE' },
];

// Chip taxonomy: media kind first (audio, live video), then source for the
// snapshot fleets. Cams outside these buckets (ski hills, campus cams) still
// show under ALL and in text search.
function chipOf(cam: Camera): ChipId | null {
  if (cam.kind === 'audio') return 'audio';
  if (cam.kind === 'iframe' || cam.kind === 'hls') return 'live';
  if (cam.sourceSlug === 'drivebc-highwaycams') return 'road';
  if (cam.sourceSlug === 'bc-ferries-terminal-cams') return 'harbour';
  return null;
}

// Default sort: audio and live streams first, then snapshots, A to Z inside
// each band. Pinned cams are pulled out into their own row before this runs.
const KIND_RANK: Record<Camera['kind'], number> = { audio: 0, hls: 1, iframe: 1, snapshot: 2 };

function defaultOrder(a: Camera, b: Camera): number {
  return KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.name.localeCompare(b.name);
}

const GRID: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
  gap: 'var(--s3)',
};

export function CamsPage() {
  const cameras = useQuery(api.cameras.list, {});
  const { pinned, togglePin } = usePinnedCams();
  const [chip, setChip] = useState<ChipId>('all');
  const [text, setText] = useState('');

  const searched = useMemo(() => {
    if (!cameras) return [];
    const q = text.trim().toLowerCase();
    if (!q) return cameras;
    return cameras.filter(
      (c) => c.name.toLowerCase().includes(q) || c.attribution.toLowerCase().includes(q),
    );
  }, [cameras, text]);

  const chipCounts = useMemo(() => {
    const counts: Record<ChipId, number> = { all: searched.length, road: 0, harbour: 0, audio: 0, live: 0 };
    for (const c of searched) {
      const id = chipOf(c);
      if (id) counts[id] += 1;
    }
    return counts;
  }, [searched]);

  const visible = useMemo(() => {
    const matched = chip === 'all' ? searched : searched.filter((c) => chipOf(c) === chip);
    return [...matched].sort(defaultOrder);
  }, [searched, chip]);

  const pinnedCams = visible.filter((c) => pinned.has(c.slug));
  const restCams = visible.filter((c) => !pinned.has(c.slug));

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--s2)',
          padding: 'var(--s2) var(--s3)',
          background: 'var(--bg-1)',
          borderBottom: '1px solid var(--border-hairline)',
          flexShrink: 0,
          flexWrap: 'wrap',
        }}
      >
        <span className="microlabel" style={{ color: 'var(--accent-live)', marginRight: 'var(--s2)' }}>
          CAM WALL
        </span>

        {CHIPS.map((c) => {
          const active = chip === c.id;
          return (
            <button
              key={c.id}
              onClick={() => setChip(c.id)}
              className="pill"
              aria-pressed={active}
              style={{
                cursor: 'pointer',
                background: active ? 'var(--bg-3)' : 'none',
                borderColor: active ? 'var(--border-hairline-strong)' : 'var(--border-hairline)',
                color: active ? 'var(--text-1)' : 'var(--text-3)',
              }}
            >
              {c.label}
              <span style={{ color: active ? 'var(--text-2)' : 'var(--text-3)' }}>
                {chipCounts[c.id]}
              </span>
            </button>
          );
        })}

        <div style={{ flex: 1 }} />

        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="filter by name or source"
          aria-label="Filter cameras"
          className="mono"
          style={{
            background: 'var(--bg-0)',
            border: '1px solid var(--border-hairline)',
            borderRadius: 2,
            color: 'var(--text-1)',
            padding: '3px 8px',
            width: 220,
            outline: 'none',
          }}
        />

        <span className="mono" style={{ color: 'var(--text-2)' }}>
          {visible.length}
          <span style={{ color: 'var(--text-3)' }}> of {cameras?.length ?? 0} feeds</span>
        </span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--s3)' }}>
        {cameras === undefined ? (
          <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 'var(--s8)' }}>
            <span className="microlabel">LOADING CAM INVENTORY…</span>
          </div>
        ) : visible.length === 0 ? (
          <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 'var(--s8)' }}>
            <span className="microlabel">NO CAMS MATCH THIS FILTER</span>
          </div>
        ) : (
          <>
            {pinnedCams.length > 0 && (
              <section style={{ marginBottom: 'var(--s4)' }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--s2)',
                    marginBottom: 'var(--s2)',
                  }}
                >
                  <span className="microlabel" style={{ color: 'var(--warn)' }}>
                    ★ PINNED
                  </span>
                  <span className="mono" style={{ color: 'var(--text-3)', fontSize: 11 }}>
                    {pinnedCams.length}
                  </span>
                  <div style={{ flex: 1, borderTop: '1px solid var(--border-hairline)' }} />
                </div>
                <div style={GRID}>
                  {pinnedCams.map((cam) => (
                    <CamTile key={cam.slug} camera={cam} pinned onTogglePin={togglePin} />
                  ))}
                </div>
              </section>
            )}

            {pinnedCams.length > 0 && restCams.length > 0 && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--s2)',
                  marginBottom: 'var(--s2)',
                }}
              >
                <span className="microlabel">ALL FEEDS</span>
                <span className="mono" style={{ color: 'var(--text-3)', fontSize: 11 }}>
                  {restCams.length}
                </span>
                <div style={{ flex: 1, borderTop: '1px solid var(--border-hairline)' }} />
              </div>
            )}

            <div style={GRID}>
              {restCams.map((cam) => (
                <CamTile key={cam.slug} camera={cam} pinned={false} onTogglePin={togglePin} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
