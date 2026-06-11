import type { LayerDef } from './types';
import { quakesLayer } from './defs/quakes';
import { radarLayer, satelliteLayer, lightningLayer } from './defs/geometRasters';
import { alertsLayer } from './defs/alerts';
import { tremorLayer } from './defs/tremor';
import { firesLayer } from './defs/fires';
import { hotspotsLayer } from './defs/hotspots';
import { outagesLayer } from './defs/outages';
import { roadEventsLayer } from './defs/roadEvents';
import { aircraftLayer } from './defs/aircraft';
import { transitLayer } from './defs/transit';
import { ferriesLayer } from './defs/ferries';
import { tideStationsLayer } from './defs/tideStations';
import { buoysLayer } from './defs/buoys';
import { wxStationsLayer } from './defs/wxStations';
import { aqhiLayer } from './defs/aqhi';
import { riversLayer } from './defs/rivers';
import { camsLayer } from './defs/cams';

// One entry per map layer. Wave agents add defs in src/layers/defs/; the
// orchestrator merges them here (serialized — ARCHITECTURE §2/§10).
// Order = draw order for deck layers; rasters always sit below labels.
// Polygons before points so markers stay clickable above fills.
export const LAYER_REGISTRY: LayerDef[] = [
  radarLayer,
  satelliteLayer,
  lightningLayer,
  alertsLayer as LayerDef,
  firesLayer as LayerDef,
  tremorLayer as LayerDef,
  hotspotsLayer as LayerDef,
  quakesLayer as LayerDef,
  outagesLayer as LayerDef,
  roadEventsLayer as LayerDef,
  aqhiLayer as LayerDef,
  buoysLayer as LayerDef,
  tideStationsLayer as LayerDef,
  riversLayer as LayerDef,
  wxStationsLayer as LayerDef,
  camsLayer as LayerDef,
  transitLayer as LayerDef,
  ferriesLayer as LayerDef,
  aircraftLayer as LayerDef,
];
