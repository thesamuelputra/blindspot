import { useEffect, useState } from 'react';
import { useMutation } from 'convex/react';
import { api } from '../../../convex/_generated/api';

// Push opt-in (DECISIONS D5). Hidden until VITE_VAPID_PUBLIC_KEY is set at
// build time (Samuel's keys queue: npx web-push generate-vapid-keys).
const VAPID_PUBLIC = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function PushSubscribe() {
  const subscribe = useMutation(api.pushSubscriptions.subscribe);
  const [state, setState] = useState<'idle' | 'on' | 'busy' | 'denied' | 'unsupported'>('idle');

  useEffect(() => {
    if (!VAPID_PUBLIC || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      setState('unsupported');
      return;
    }
    void navigator.serviceWorker.ready.then(async (reg) => {
      const sub = await reg.pushManager.getSubscription();
      if (sub) setState('on');
    });
  }, []);

  if (!VAPID_PUBLIC || state === 'unsupported') return null;

  const enable = async () => {
    setState('busy');
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setState('denied');
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC).buffer as ArrayBuffer,
      });
      const json = sub.toJSON();
      await subscribe({ endpoint: sub.endpoint, keys: JSON.stringify(json.keys ?? {}) });
      setState('on');
    } catch {
      setState('idle');
    }
  };

  return (
    <button
      onClick={() => void enable()}
      disabled={state === 'on' || state === 'busy'}
      className="pill"
      style={{
        color: state === 'on' ? 'var(--ok)' : 'var(--text-2)',
        background: 'none',
        cursor: state === 'on' ? 'default' : 'pointer',
      }}
      title={state === 'denied' ? 'notifications blocked in browser settings' : undefined}
    >
      <span className="dot" style={{ background: state === 'on' ? 'var(--ok)' : 'var(--text-3)' }} />
      {state === 'on' ? 'PUSH ON' : state === 'busy' ? 'ENABLING…' : state === 'denied' ? 'PUSH BLOCKED' : 'ENABLE PUSH'}
    </button>
  );
}
