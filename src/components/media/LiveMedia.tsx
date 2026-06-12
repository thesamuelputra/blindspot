import { useEffect, useRef, useState } from 'react';
import { useNow } from '@/lib/time';
import type { CameraDoc } from '@/state/ui';

// In-platform media resolver (BRIEF §6): snapshot / hls / iframe / audio.
// Zero redirects — everything plays here. "Open original ↗" never auto-fires.

export function LiveMedia({ camera }: { camera: CameraDoc }) {
  switch (camera.kind) {
    case 'snapshot':
      return <Snapshot camera={camera} />;
    case 'hls':
      return <HlsVideo url={camera.mediaUrl} />;
    case 'iframe':
      return (
        <iframe
          src={camera.mediaUrl}
          title={camera.name}
          sandbox="allow-scripts allow-same-origin allow-presentation"
          allow="autoplay; encrypted-media; picture-in-picture"
          style={{ width: '100%', aspectRatio: '16/9', border: 'none', background: '#000' }}
        />
      );
    case 'audio':
      return <HlsAudio baseUrl={camera.mediaUrl} />;
  }
}

function Snapshot({ camera }: { camera: CameraDoc }) {
  // refresh at the camera's OWN native rate (Samuel: max rate per cam). The
  // 2s floor only stops a misconfigured cam from hammering; it never slows a
  // cam that genuinely updates faster than the old 15s default.
  const refreshMs = Math.max(camera.refreshSec ?? 30, 2) * 1000;
  const sep = camera.mediaUrl.includes('?') ? '&' : '?';
  const bust = (t: number) => `${camera.mediaUrl}${sep}_t=${t}`;

  const [shown, setShown] = useState(() => bust(Date.now())); // currently visible frame
  const [shownAt, setShownAt] = useState(() => Date.now());
  const [error, setError] = useState(false);
  const pending = useRef<HTMLImageElement | null>(null);
  const now = useNow(2000);

  useEffect(() => {
    const fetchNext = () => {
      const t = Date.now();
      const next = bust(t);
      // preload off-screen, promote only once decoded → no black flash
      const img = new Image();
      pending.current = img;
      img.onload = () => {
        if (pending.current !== img) return;
        setShown(next);
        setShownAt(t);
        setError(false);
      };
      img.onerror = () => {
        if (pending.current === img) setError(true);
      };
      img.src = next;
    };
    const id = setInterval(fetchNext, refreshMs);
    return () => {
      clearInterval(id);
      pending.current = null;
    };
  }, [refreshMs, camera.mediaUrl]);

  const age = Math.max(0, Math.floor((now - shownAt) / 1000));
  return (
    <div>
      <div style={{ position: 'relative' }}>
        <img
          src={shown}
          alt={camera.name}
          onError={() => setError(true)}
          style={{ width: '100%', display: 'block', background: '#000' }}
        />
        <span
          className="dot"
          title="live"
          style={{
            position: 'absolute',
            top: 6,
            right: 6,
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: error ? 'var(--critical)' : 'var(--ok)',
            boxShadow: error ? 'none' : '0 0 6px var(--ok)',
          }}
        />
      </div>
      <div className="microlabel" style={{ padding: '4px 0' }}>
        {error ? 'STALLED · RETRYING' : `live · updated ${age}s ago · every ${Math.round(refreshMs / 1000)}s`}
      </div>
    </div>
  );
}

function useHls(url: string | null, mediaRef: React.RefObject<HTMLMediaElement | null>) {
  const [status, setStatus] = useState<'loading' | 'playing' | 'error'>('loading');
  useEffect(() => {
    const el = mediaRef.current;
    if (!el || !url) return;
    let hls: { destroy(): void } | undefined;
    let cancelled = false;
    if (el.canPlayType('application/vnd.apple.mpegurl')) {
      el.src = url;
      setStatus('playing');
    } else {
      void import('hls.js').then(({ default: Hls }) => {
        if (cancelled || !Hls.isSupported()) return;
        const h = new Hls({ liveDurationInfinity: true });
        h.loadSource(url);
        h.attachMedia(el as HTMLVideoElement);
        h.on(Hls.Events.MANIFEST_PARSED, () => setStatus('playing'));
        h.on(Hls.Events.ERROR, (_e, data) => {
          if (data.fatal) setStatus('error');
        });
        hls = h;
      });
    }
    return () => {
      cancelled = true;
      hls?.destroy();
    };
  }, [url, mediaRef]);
  return status;
}

function HlsVideo({ url }: { url: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const status = useHls(url, ref);
  return (
    <div>
      <video ref={ref} controls autoPlay muted playsInline style={{ width: '100%', background: '#000' }} />
      {status === 'error' && <div className="microlabel">STREAM ERROR</div>}
    </div>
  );
}

// Orcasound-style audio: mediaUrl is the S3 node base; resolve latest.txt →
// hls/<ts>/live.m3u8 (folder rolls over — re-resolve on stall/start).
function HlsAudio({ baseUrl }: { baseUrl: string }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [url, setUrl] = useState<string | null>(baseUrl.includes('.m3u8') ? baseUrl : null);
  const [resolveError, setResolveError] = useState(false);

  useEffect(() => {
    if (url) return;
    let cancelled = false;
    void fetch(`${baseUrl}/latest.txt`)
      .then((r) => r.text())
      .then((ts) => {
        if (!cancelled) setUrl(`${baseUrl}/hls/${ts.trim()}/live.m3u8`);
      })
      .catch(() => setResolveError(true));
    return () => {
      cancelled = true;
    };
  }, [baseUrl, url]);

  const status = useHls(url, ref);
  return (
    <div>
      <audio ref={ref} controls style={{ width: '100%' }} />
      <div className="microlabel" style={{ padding: '4px 0' }}>
        {resolveError ? 'STREAM UNAVAILABLE' : status === 'playing' ? 'LIVE HYDROPHONE' : 'TUNING…'}
      </div>
    </div>
  );
}
