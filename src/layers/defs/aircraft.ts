import { useMemo } from 'react';
import { useQuery } from 'convex/react';
import { IconLayer } from '@deck.gl/layers';
import { api } from '../../../convex/_generated/api';
import { ACCENT_LIVE, type LayerDef, type LayerCtx } from '../types';
import { useAnimatedSnapshot } from '@/map/useAnimatedSnapshot';
import { buildMoverLabels } from '../moverText';

// Live aircraft from the positions:aircraft snapshot (never raw entity scans —
// ARCHITECTURE §10). Marker identity contract: planes and rotorcraft get
// distinct icons, military reads amber, the callsign rides under the marker.
export interface SnapshotMover {
  id: string;
  label: string;
  lat: number;
  lng: number;
  h?: number; // heading
  s?: number; // speed (kt)
  a?: number; // altitude
  t?: string; // display tag (bus route, ferry route code, sonde type)
  c?: string; // category (plane|heli|bus|ferry|balloon|cargo|tanker|…)
  m?: boolean; // military
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

export const MOVER_ATLAS = '/icons/movers.png';
export const MOVER_MAPPING = {
  chevron: { x: 0, y: 0, width: 64, height: 64, mask: true },
  plane: { x: 64, y: 0, width: 64, height: 64, mask: true },
  heli: { x: 128, y: 0, width: 64, height: 64, mask: true },
  bus: { x: 192, y: 0, width: 64, height: 64, mask: true },
  balloon: { x: 256, y: 0, width: 64, height: 64, mask: true },
  boat: { x: 320, y: 0, width: 64, height: 64, mask: true },
};

const MIL_AMBER: [number, number, number, number] = [245, 158, 11, 255];

export const aircraftLayer: LayerDef<SnapshotMover> = {
  id: 'aircraft',
  label: 'AIRCRAFT',
  pages: ['command', 'skies-seas'],
  cluster: 'Skies (Air)',
  defaultOn: true,
  useData() {
    return useAnimatedSnapshot('positions:aircraft');
  },
  toLayers(data, _ctx?: LayerCtx) {
    return [
      new IconLayer<SnapshotMover>({
        id: 'aircraft',
        data,
        iconAtlas: MOVER_ATLAS,
        iconMapping: MOVER_MAPPING,
        getIcon: (d) => (d.c === 'heli' ? 'heli' : 'plane'),
        getPosition: (d) => [d.lng, d.lat],
        // deck.gl rotates counterclockwise; heading is clockwise from north
        getAngle: (d) => -(d.h ?? 0),
        getColor: (d) => (d.m ? MIL_AMBER : ACCENT_LIVE),
        getSize: (d) => (d.c === 'heli' ? 18 : 17),
        sizeUnits: 'pixels',
        pickable: true,
      }),
      // callsign tags — aircraft are few enough to label at every zoom
      ...buildMoverLabels('aircraft-labels', data, {
        getText: (d) => d.label,
        getColor: (d) => (d.m ? MIL_AMBER : [56, 189, 248, 235]),
        offsetY: 13,
      }),
    ];
  },
};
