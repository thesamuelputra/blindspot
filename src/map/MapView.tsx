import type { Layer } from '@deck.gl/core';
import { LAYER_REGISTRY } from '@/layers/registry';
import { LayerRail } from '@/layers/LayerRail';
import type { LayerData } from '@/layers/types';
import { useUi } from '@/state/ui';
import { MapShell } from './MapShell';

// Assembles registry data for one page and feeds MapShell + the rail.
export function MapView({ page }: { page: string }) {
  const layersOn = useUi((s) => s.layersOn);
  const defs = LAYER_REGISTRY.filter((d) => d.pages.includes(page));

  const dataById: Record<string, LayerData> = {};
  const deckLayers: Layer[] = [];
  for (const def of defs) {
    // Hook call in a loop is safe here: LAYER_REGISTRY is a static module-level
    // array, so hook order is stable across renders by construction.
    const data = def.useData();
    dataById[def.id] = data;
    if (layersOn[def.id] ?? def.defaultOn) deckLayers.push(...def.toLayers(data.data));
  }

  return (
    <MapShell layers={deckLayers}>
      <LayerRail defs={defs} dataById={dataById} />
    </MapShell>
  );
}
