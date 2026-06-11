import { useMemo } from 'react';
import { useQuery } from 'convex/react';
import { IconLayer } from '@deck.gl/layers';
import { api } from '../../../convex/_generated/api';
import { ACCENT_LIVE, type LayerDef } from '../types';
import { useAnimatedSnapshot } from '@/map/useAnimatedSnapshot';

// Live aircraft from the positions:aircraft snapshot (never raw entity scans —
// ARCHITECTURE §10). Oriented chevrons, accent-live cyan.
export interface SnapshotMover {
  id: string;
  label: string;
  lat: number;
  lng: number;
  h?: number; // heading
  s?: number; // speed
  a?: number; // altitude
}

const EMPTY: SnapshotMover[] = [];

export function useSnapshot(key: string): { data: SnapshotMover[]; updatedAt?: number } {
  const row = useQuery(api.snapshots.get, { key });
  // memoized on row identity — a referentially fresh array per render caused
  // an infinite effect cascade downstream (AUDIT finding, Phase 6)
  const data = useMemo(() => {
    if (!row) return EMPTY;
    try {
      return JSON.parse(row.json) as SnapshotMover[];
    } catch {
      return EMPTY;
    }
  }, [row]);
  return { data, updatedAt: row?.updatedAt };
}

export const aircraftLayer: LayerDef<SnapshotMover> = {
  id: 'aircraft',
  label: 'AIRCRAFT',
  pages: ['command', 'skies-seas'],
  cluster: 'Skies (Air)',
  defaultOn: true,
  useData() {
    return useAnimatedSnapshot('positions:aircraft');
  },
  toLayers(data) {
    return [
      new IconLayer<SnapshotMover>({
        id: 'aircraft',
        data,
        iconAtlas: '/icons/chevron.png',
        iconMapping: { mover: { x: 0, y: 0, width: 64, height: 64, mask: true } },
        getIcon: () => 'mover',
        getPosition: (d) => [d.lng, d.lat],
        // deck.gl rotates counterclockwise; heading is clockwise from north
        getAngle: (d) => -(d.h ?? 0),
        getColor: ACCENT_LIVE,
        getSize: 16,
        sizeUnits: 'pixels',
        pickable: true,
      }),
    ];
  },
};
