import { useCallback } from 'react';
import { useQuery } from 'convex/react';
import type { Layer, PickingInfo } from '@deck.gl/core';
import { PathLayer } from '@deck.gl/layers';
import { api } from '../../convex/_generated/api';
import { LAYER_REGISTRY } from '@/layers/registry';
import { LayerRail } from '@/layers/LayerRail';
import type { LayerData } from '@/layers/types';
import { useUi, type CameraDoc } from '@/state/ui';
import { Inspector } from '@/components/inspector/Inspector';
import { MapShell, type RasterToggle } from './MapShell';

// Which mover kind each pickable mover layer carries (pick mapping).
const MOVER_KIND_BY_LAYER: Record<string, string> = {
  aircraft: 'aircraft',
  vessels: 'vessel',
  ferries: 'ferry',
  transit: 'bus',
  sondes: 'balloon',
};

const TRAIL_HOVER_MS = 2 * 3600_000;
const TRAIL_INSPECT_MS = 12 * 3600_000;

function trailToLayers(
  id: string,
  trail: { points: Array<{ lat: number; lng: number }> } | null | undefined,
  color: [number, number, number],
): Layer[] {
  if (!trail || trail.points.length < 2) return [];
  // segment-wise alpha ramp: oldest faint, newest solid — the path reads as motion
  const segs = [];
  for (let i = 1; i < trail.points.length; i++) {
    const a = trail.points[i - 1];
    const b = trail.points[i];
    segs.push({
      path: [
        [a.lng, a.lat],
        [b.lng, b.lat],
      ] as [number, number][],
      alpha: 40 + Math.round(180 * (i / trail.points.length)),
    });
  }
  return [
    new PathLayer<{ path: [number, number][]; alpha: number }>({
      id,
      data: segs,
      getPath: (d) => d.path,
      getColor: (d) => [color[0], color[1], color[2], d.alpha],
      getWidth: 1.5,
      widthUnits: 'pixels',
      capRounded: true,
      jointRounded: true,
    }),
  ];
}

// Assembles registry data for one page and feeds MapShell + the rail.
export function MapView({ page }: { page: string }) {
  const layersOn = useUi((s) => s.layersOn);
  const hoverMover = useUi((s) => s.hoverMover);
  const setHoverMover = useUi((s) => s.setHoverMover);
  const inspect = useUi((s) => s.inspect);
  const setInspect = useUi((s) => s.setInspect);
  const defs = LAYER_REGISTRY.filter((d) => d.pages.includes(page));

  const dataById: Record<string, LayerData> = {};
  const deckLayers: Layer[] = [];
  const rasters: RasterToggle[] = [];

  for (const def of defs) {
    const on = layersOn[def.id] ?? def.defaultOn;
    if (def.raster) {
      rasters.push({ id: def.id, spec: def.raster, on });
      dataById[def.id] = { data: [] };
      continue;
    }
    // Hook call in a loop is safe here: LAYER_REGISTRY is a static module-level
    // array, so hook order is stable across renders by construction.
    const data = def.useData!();
    dataById[def.id] = data;
    if (on) deckLayers.push(...def.toLayers!(data.data));
  }

  // hover + inspected trails (ARCHITECTURE §10 interaction contract)
  const inspectedMover = inspect?.type === 'mover' ? inspect : null;
  const hoverTrail = useQuery(
    api.tracks.trail,
    hoverMover && hoverMover.extId !== inspectedMover?.extId
      ? { kind: hoverMover.kind, extId: hoverMover.extId, sinceMs: TRAIL_HOVER_MS }
      : 'skip',
  );
  const inspectTrail = useQuery(
    api.tracks.trail,
    inspectedMover
      ? { kind: inspectedMover.kind, extId: inspectedMover.extId, sinceMs: TRAIL_INSPECT_MS, limit: 500 }
      : 'skip',
  );
  deckLayers.push(...trailToLayers('trail-hover', hoverTrail, [56, 189, 248]));
  deckLayers.push(...trailToLayers('trail-inspect', inspectTrail, [167, 139, 250]));

  const onPickHover = useCallback(
    (info: PickingInfo) => {
      const kind = info.layer ? MOVER_KIND_BY_LAYER[info.layer.id] : undefined;
      const obj = info.object as { id?: string } | undefined;
      if (kind && obj?.id) setHoverMover({ kind, extId: obj.id });
      else setHoverMover(null);
    },
    [setHoverMover],
  );

  const onPickClick = useCallback(
    (info: PickingInfo) => {
      if (!info.object || !info.layer) {
        setInspect(null);
        return;
      }
      const layerId = info.layer.id;
      const moverKind = MOVER_KIND_BY_LAYER[layerId];
      if (moverKind) {
        const m = info.object as { id: string; label: string };
        setInspect({ type: 'mover', kind: moverKind, extId: m.id, label: m.label });
        return;
      }
      if (layerId === 'cams') {
        setInspect({ type: 'camera', camera: info.object as CameraDoc });
        return;
      }
      setInspect({ type: 'signal', data: info.object as Record<string, unknown> });
    },
    [setInspect],
  );

  return (
    <MapShell layers={deckLayers} rasters={rasters} onPickHover={onPickHover} onPickClick={onPickClick}>
      <LayerRail defs={defs} dataById={dataById} />
      {inspect && <Inspector target={inspect} trail={inspectTrail ?? null} onClose={() => setInspect(null)} />}
    </MapShell>
  );
}
