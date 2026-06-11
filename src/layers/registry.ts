import type { LayerDef } from './types';
import { quakesLayer } from './defs/quakes';
import { radarLayer, satelliteLayer, lightningLayer } from './defs/geometRasters';

// One entry per map layer. Wave agents add defs in src/layers/defs/; the
// orchestrator merges them here (serialized — ARCHITECTURE §2/§10).
// Order = draw order for deck layers; rasters always sit below labels.
export const LAYER_REGISTRY: LayerDef[] = [
  radarLayer,
  satelliteLayer,
  lightningLayer,
  quakesLayer as LayerDef,
];
