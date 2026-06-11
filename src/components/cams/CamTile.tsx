import { useEffect, useRef, useState } from 'react';
import { LiveMedia } from '@/components/media/LiveMedia';
import type { Doc } from '../../../convex/_generated/dataModel';

type Camera = Doc<'cameras'>;

// One tile on the cam wall. Two cost gates keep 230 cams cheap:
// 1. Nothing mounts until the tile is in or near the viewport
//    (IntersectionObserver; offscreen snapshots also unmount, which stops
//    their refresh timers).
// 2. Stream and audio tiles (iframe / hls / audio) never start on their own.
//    The player mounts only after an explicit click, and an armed player
//    stays mounted while you scroll so audio keeps playing.

function useNearViewport(margin: number): {
  ref: React.RefObject<HTMLDivElement | null>;
  near: boolean;
} {
  const ref = useRef<HTMLDivElement | null>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setNear(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) setNear(e.isIntersecting);
      },
      { rootMargin: `${margin}px 0px` },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [margin]);
  return { ref, near };
}

const KIND_LABEL: Record<Camera['kind'], string> = {
  snapshot: 'SNAPSHOT',
  hls: 'STREAM',
  iframe: 'STREAM',
  audio: 'AUDIO',
};

const KIND_COLOR: Record<Camera['kind'], string> = {
  snapshot: 'var(--text-3)',
  hls: 'var(--accent-live)',
  iframe: 'var(--accent-live)',
  audio: 'var(--intel)',
};

export function CamTile({
  camera,
  pinned,
  onTogglePin,
}: {
  camera: Camera;
  pinned: boolean;
  onTogglePin: (slug: string) => void;
}) {
  const { ref, near } = useNearViewport(500);
  const [armed, setArmed] = useState(false);
  const needsArm = camera.kind !== 'snapshot';
  // snapshots follow visibility; stream/audio follow the explicit arm switch
  const showMedia = needsArm ? armed : near;

  return (
    <div
      ref={ref}
      style={{
        background: 'var(--bg-2)',
        border: '1px solid var(--border-hairline)',
        borderRadius: 2,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--s2)',
          padding: '6px 8px',
          borderBottom: '1px solid var(--border-hairline)',
        }}
      >
        <span
          className="mono"
          title={camera.name}
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--text-1)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            minWidth: 0,
            flex: 1,
          }}
        >
          {camera.name}
        </span>
        {needsArm && armed && (
          <button
            onClick={() => setArmed(false)}
            className="microlabel"
            title="Stop this feed"
            style={{
              background: 'none',
              border: '1px solid var(--border-hairline)',
              color: 'var(--text-2)',
              cursor: 'pointer',
              padding: '1px 6px',
              borderRadius: 2,
            }}
          >
            STOP
          </button>
        )}
        <button
          onClick={() => onTogglePin(camera.slug)}
          className="mono"
          title={pinned ? 'Unpin' : 'Pin to top'}
          aria-pressed={pinned}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '0 2px',
            fontSize: 13,
            lineHeight: 1,
            color: pinned ? 'var(--warn)' : 'var(--text-3)',
          }}
        >
          {pinned ? '★' : '☆'}
        </button>
      </div>

      <div style={{ minHeight: 150, background: 'var(--bg-0)' }}>
        {showMedia ? (
          <LiveMedia camera={camera} />
        ) : needsArm && near ? (
          <button
            onClick={() => setArmed(true)}
            style={{
              width: '100%',
              aspectRatio: '16/9',
              background: 'var(--bg-0)',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            <span
              className="mono"
              aria-hidden
              style={{ fontSize: 20, color: KIND_COLOR[camera.kind], lineHeight: 1 }}
            >
              ▶
            </span>
            <span className="microlabel" style={{ color: 'var(--text-2)' }}>
              START {KIND_LABEL[camera.kind]}
            </span>
            <span className="microlabel">LOADS ONLY ON CLICK</span>
          </button>
        ) : (
          <div
            style={{
              aspectRatio: '16/9',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 'var(--s3)',
            }}
          >
            <span className="microlabel" style={{ textAlign: 'center' }}>
              {camera.name}
            </span>
          </div>
        )}
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--s2)',
          padding: '5px 8px',
          borderTop: '1px solid var(--border-hairline)',
          marginTop: 'auto',
        }}
      >
        <span className="microlabel" style={{ color: KIND_COLOR[camera.kind] }}>
          {KIND_LABEL[camera.kind]}
        </span>
        <span
          className="microlabel"
          title={camera.attribution}
          style={{
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            minWidth: 0,
            marginLeft: 'auto',
          }}
        >
          {camera.attribution}
        </span>
      </div>
    </div>
  );
}
