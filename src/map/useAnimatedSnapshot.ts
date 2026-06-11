import { useEffect, useRef, useState } from 'react';
import { useSnapshot, type SnapshotMover } from '@/layers/defs/aircraft';

// Dead-reckons mover positions between fixes so the board feels live
// (ARCHITECTURE §10 interaction contract). Presentation only — the inspector
// shows true fix age. Extrapolation caps at 5 min, then markers freeze.
const TICK_MS = 1000;
const MAX_EXTRAPOLATE_MS = 5 * 60_000;
const KT_TO_MPS = 0.514444;
const EARTH_M_PER_DEG_LAT = 111_320;

export interface AnimatedMover extends SnapshotMover {
  fixLat: number;
  fixLng: number;
  fixAt: number;
  extrapolated: boolean;
}

export function useAnimatedSnapshot(key: string): {
  data: AnimatedMover[];
  updatedAt?: number;
} {
  const { data: raw, updatedAt } = useSnapshot(key);
  // remember when each mover's fix last CHANGED (snapshot updatedAt is batch-level)
  const fixesRef = useRef<Map<string, { lat: number; lng: number; at: number }>>(new Map());
  const [animated, setAnimated] = useState<AnimatedMover[]>([]);

  useEffect(() => {
    const now = Date.now();
    const fixes = fixesRef.current;
    const seen = new Set<string>();
    for (const m of raw) {
      seen.add(m.id);
      const prev = fixes.get(m.id);
      if (!prev || prev.lat !== m.lat || prev.lng !== m.lng) {
        fixes.set(m.id, { lat: m.lat, lng: m.lng, at: now });
      }
    }
    for (const id of fixes.keys()) if (!seen.has(id)) fixes.delete(id);
  }, [raw]);

  useEffect(() => {
    let mounted = true;
    const project = () => {
      if (!mounted) return;
      const now = Date.now();
      setAnimated(
        raw.map((m) => {
          const fix = fixesRef.current.get(m.id) ?? { lat: m.lat, lng: m.lng, at: now };
          const dt = Math.min(now - fix.at, MAX_EXTRAPOLATE_MS);
          const speedKt = m.s ?? 0;
          const heading = m.h;
          if (speedKt < 1 || heading === undefined || dt <= 0) {
            return { ...m, fixLat: fix.lat, fixLng: fix.lng, fixAt: fix.at, extrapolated: false };
          }
          const dist = speedKt * KT_TO_MPS * (dt / 1000); // meters along heading
          const rad = (heading * Math.PI) / 180;
          const dLat = (dist * Math.cos(rad)) / EARTH_M_PER_DEG_LAT;
          const dLng =
            (dist * Math.sin(rad)) /
            (EARTH_M_PER_DEG_LAT * Math.cos((fix.lat * Math.PI) / 180));
          return {
            ...m,
            lat: fix.lat + dLat,
            lng: fix.lng + dLng,
            fixLat: fix.lat,
            fixLng: fix.lng,
            fixAt: fix.at,
            extrapolated: true,
          };
        }),
      );
    };
    project();
    const id = setInterval(project, TICK_MS);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, [raw]);

  return { data: animated, updatedAt };
}
