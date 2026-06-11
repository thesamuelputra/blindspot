import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';

// One orchestrated load moment (BRIEF §12): plays once per session after
// auth, then gets out of the way. Skipped entirely under reduced motion.
const LINES = ['ESTABLISHING UPLINK', 'OPERATOR CHANNEL SECURE', 'SYNCING FEED NETWORK', 'BLINDSPOT ONLINE'];
const LINE_MS = 320;
const HOLD_MS = 520;

export function BootSequence() {
  const [done, setDone] = useState(() => {
    if (typeof window === 'undefined') return true;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return true;
    return sessionStorage.getItem('bs-booted') === '1';
  });
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (done) return;
    if (shown < LINES.length) {
      const id = setTimeout(() => setShown((n) => n + 1), LINE_MS);
      return () => clearTimeout(id);
    }
    const id = setTimeout(() => {
      sessionStorage.setItem('bs-booted', '1');
      setDone(true);
    }, HOLD_MS);
    return () => clearTimeout(id);
  }, [done, shown]);

  return (
    <AnimatePresence>
      {!done && (
        <motion.div
          exit={{ opacity: 0 }}
          transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 200,
            background: 'var(--bg-0)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div style={{ width: 320 }}>
            {LINES.slice(0, shown).map((line, i) => (
              <motion.div
                key={line}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                className="mono"
                style={{
                  fontSize: 12,
                  letterSpacing: '0.14em',
                  padding: '3px 0',
                  color: i === LINES.length - 1 ? 'var(--accent-live)' : 'var(--text-2)',
                }}
              >
                <span style={{ color: 'var(--text-3)' }}>{String(i + 1).padStart(2, '0')} </span>
                {line}
                {i === shown - 1 && i < LINES.length - 1 && <span style={{ color: 'var(--text-3)' }}>…</span>}
              </motion.div>
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
