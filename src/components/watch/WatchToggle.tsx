import { useMutation, useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';

// Star/unstar for the Inspector mover panel (BRIEF §8.3). Reflects live
// watchlist membership via its own targeted query; amber = watched, matching
// the watch tier of the severity scale. Public assets only per guardrails.

export function WatchToggle({
  kind,
  extId,
  label,
}: {
  kind: string;
  extId: string;
  label: string;
}) {
  const row = useQuery(api.watchlist.forIdent, { kind, identifier: extId });
  const add = useMutation(api.watchlist.add);
  const remove = useMutation(api.watchlist.remove);

  const loading = row === undefined;
  const on = !!row;

  return (
    <button
      type="button"
      disabled={loading}
      title={on ? 'Remove from watchlist' : 'Add to watchlist'}
      onClick={() => {
        if (loading) return;
        if (row) void remove({ id: row._id });
        else void add({ kind, identifier: extId, label });
      }}
      className="mono"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '2px 8px',
        background: 'none',
        border: `1px solid ${on ? 'rgba(245,158,11,0.45)' : 'var(--border-hairline)'}`,
        borderRadius: 2,
        color: on ? 'var(--warn)' : 'var(--text-2)',
        fontSize: 10,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        cursor: loading ? 'default' : 'pointer',
        opacity: loading ? 0.5 : 1,
        transition: 'color var(--t-fast) var(--ease-ops), border-color var(--t-fast) var(--ease-ops)',
      }}
    >
      <span aria-hidden style={{ fontSize: 12, lineHeight: 1 }}>
        {on ? '★' : '☆'}
      </span>
      {on ? 'WATCHING' : 'WATCH'}
    </button>
  );
}
