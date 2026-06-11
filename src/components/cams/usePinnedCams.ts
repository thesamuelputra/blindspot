import { useCallback, useMemo, useState } from 'react';

// Pinned cam slugs persist across sessions. Plain localStorage, no sync —
// pins are a per-browser operator preference, not shared state.
const STORAGE_KEY = 'blindspot:cams:pinned';

function load(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

export function usePinnedCams(): { pinned: Set<string>; togglePin: (slug: string) => void } {
  const [slugs, setSlugs] = useState<string[]>(load);

  const togglePin = useCallback((slug: string) => {
    setSlugs((prev) => {
      const next = prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug];
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // storage full or blocked: pin still works for this session
      }
      return next;
    });
  }, []);

  const pinned = useMemo(() => new Set(slugs), [slugs]);
  return { pinned, togglePin };
}
