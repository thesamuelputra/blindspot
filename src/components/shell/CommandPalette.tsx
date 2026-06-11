import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { LAYER_REGISTRY } from '@/layers/registry';
import { useUi } from '@/state/ui';

interface PaletteItem {
  id: string;
  label: string;
  hint: string;
  run: () => void;
}

const PAGES: Array<[string, string]> = [
  ['/command', 'COMMAND'],
  ['/hazard', 'HAZARD'],
  ['/skies-seas', 'SKIES & SEAS'],
  ['/ground', 'GROUND'],
  ['/signals', 'SIGNALS'],
  ['/infrastructure', 'INFRASTRUCTURE'],
  ['/pulse', 'PULSE'],
  ['/environment', 'ENVIRONMENT'],
  ['/space', 'SPACE'],
  ['/analyst', 'ANALYST'],
  ['/incidents', 'INCIDENTS'],
  ['/world', 'WORLD'],
  ['/cams', 'CAMS'],
  ['/system', 'SYSTEM'],
  ['/wall', 'WALL'],
];

const PLACES: Array<[string, number, number, number]> = [
  ['Victoria', 48.4284, -123.3656, 11],
  ['Nanaimo', 49.1659, -123.9401, 11],
  ['Comox', 49.6735, -124.9283, 11],
  ['Port Alberni', 49.2339, -124.805, 11],
  ['Campbell River', 50.0244, -125.2475, 11],
  ['Tofino', 49.153, -125.9066, 11],
  ['Haro Strait', 48.55, -123.17, 10],
  ['Juan de Fuca', 48.3, -124.2, 9],
  ['Full island', 49.35, -124.4, 7],
];

// ⌘K palette (BRIEF §12): jump to page / toggle layer / fly to place.
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const toggleLayer = useUi((s) => s.toggleLayer);
  const requestFlyTo = useUi((s) => s.requestFlyTo);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
        setQ('');
        setSel(0);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const items = useMemo<PaletteItem[]>(() => {
    const all: PaletteItem[] = [
      ...PAGES.map(([to, label]) => ({
        id: `page:${to}`,
        label,
        hint: 'go to page',
        run: () => void navigate({ to }),
      })),
      ...LAYER_REGISTRY.map((l) => ({
        id: `layer:${l.id}`,
        label: l.label,
        hint: 'toggle layer',
        run: () => toggleLayer(l.id, l.defaultOn),
      })),
      ...PLACES.map(([name, lat, lng, zoom]) => ({
        id: `fly:${name}`,
        label: name.toUpperCase(),
        hint: 'fly to',
        run: () => {
          requestFlyTo({ lat, lng, zoom });
          void navigate({ to: '/command' });
        },
      })),
    ];
    const needle = q.trim().toLowerCase();
    return needle ? all.filter((i) => i.label.toLowerCase().includes(needle)) : all;
  }, [q, navigate, toggleLayer, requestFlyTo]);

  if (!open) return null;
  return (
    <div
      onClick={() => setOpen(false)}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        background: 'rgba(5,8,10,0.6)',
        display: 'flex',
        justifyContent: 'center',
        paddingTop: '18vh',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 440,
          maxHeight: '50vh',
          background: 'var(--bg-1)',
          border: '1px solid var(--border-hairline-strong)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setSel(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') setSel((s) => Math.min(s + 1, items.length - 1));
            else if (e.key === 'ArrowUp') setSel((s) => Math.max(s - 1, 0));
            else if (e.key === 'Enter' && items[sel]) {
              items[sel].run();
              setOpen(false);
            }
          }}
          placeholder="page, layer, or place…"
          className="mono"
          style={{
            background: 'var(--bg-0)',
            border: 'none',
            borderBottom: '1px solid var(--border-hairline)',
            color: 'var(--text-1)',
            padding: '10px 12px',
            fontSize: 13,
            outline: 'none',
          }}
        />
        <div style={{ overflowY: 'auto' }}>
          {items.slice(0, 14).map((item, i) => (
            <button
              key={item.id}
              onClick={() => {
                item.run();
                setOpen(false);
              }}
              onMouseEnter={() => setSel(i)}
              className="mono"
              style={{
                display: 'flex',
                width: '100%',
                gap: 8,
                padding: '7px 12px',
                background: i === sel ? 'var(--bg-3)' : 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: 11,
                letterSpacing: '0.08em',
                color: i === sel ? 'var(--text-1)' : 'var(--text-2)',
              }}
            >
              <span style={{ flex: 1, textAlign: 'left' }}>{item.label}</span>
              <span className="microlabel">{item.hint}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
