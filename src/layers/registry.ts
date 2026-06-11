import type { LayerDef } from './types';
import { quakesLayer } from './defs/quakes';

// One entry per map layer. Wave agents add defs in src/layers/defs/; the
// orchestrator merges them here (serialized — ARCHITECTURE §2/§10).
export const LAYER_REGISTRY: LayerDef[] = [quakesLayer as LayerDef];
