import { useState } from 'react';
import { useAuthActions } from '@convex-dev/auth/react';

// Private operator console. flow="signUp" exists for first-run seeding only
// (RUNBOOK documents disabling it after the operator account exists).
export function LoginGate() {
  const { signIn } = useAuthActions();
  const [flow, setFlow] = useState<'signIn' | 'signUp'>('signIn');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-0)',
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          const formData = new FormData(e.currentTarget);
          formData.set('flow', flow);
          void signIn('password', formData)
            .catch(() => setError(flow === 'signIn' ? 'ACCESS DENIED' : 'REGISTRATION FAILED'))
            .finally(() => setBusy(false));
        }}
        style={{
          width: 320,
          padding: 'var(--s6)',
          background: 'var(--bg-1)',
          border: '1px solid var(--border-hairline)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--s3)',
        }}
      >
        <span
          className="mono"
          style={{ fontWeight: 700, letterSpacing: '0.18em', fontSize: 14, textAlign: 'center' }}
        >
          BLINDSPOT
        </span>
        <span className="microlabel" style={{ textAlign: 'center' }}>
          OPERATOR AUTHENTICATION
        </span>

        <input name="email" type="email" placeholder="operator id (email)" required style={inputStyle} />
        <input name="password" type="password" placeholder="passphrase" required style={inputStyle} />

        {error && (
          <span className="mono" style={{ color: 'var(--critical)', fontSize: 11 }}>
            {error}
          </span>
        )}

        <button type="submit" disabled={busy} style={buttonStyle}>
          {busy ? 'AUTHENTICATING…' : flow === 'signIn' ? 'ESTABLISH UPLINK' : 'REGISTER OPERATOR'}
        </button>

        <button
          type="button"
          onClick={() => setFlow(flow === 'signIn' ? 'signUp' : 'signIn')}
          className="microlabel"
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
        >
          {flow === 'signIn' ? 'first run? register operator' : 'back to sign in'}
        </button>
      </form>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: 'var(--bg-0)',
  border: '1px solid var(--border-hairline-strong)',
  color: 'var(--text-1)',
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  padding: '8px 10px',
  outline: 'none',
};

const buttonStyle: React.CSSProperties = {
  background: 'var(--bg-3)',
  border: '1px solid var(--border-hairline-strong)',
  color: 'var(--accent-live)',
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  letterSpacing: '0.12em',
  padding: '9px 10px',
  cursor: 'pointer',
};
