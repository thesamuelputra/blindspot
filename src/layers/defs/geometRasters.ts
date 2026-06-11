import type { LayerDef } from '../types';

// ECCC MSC GeoMet WMS rasters — CORS-open (verified in SOURCES.md), loaded
// browser-direct as MapLibre raster sources; no Convex feed module needed.
// No TIME param = latest frame (GeoMet default). Animation lands with the
// scrubber (Phase 4/5) via the time dimension.
const GEOMET =
  'https://geo.weather.gc.ca/geomet?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap' +
  '&CRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=256&HEIGHT=256&FORMAT=image/png&TRANSPARENT=true';

const ATTR = 'Data Source: Environment and Climate Change Canada';

export const radarLayer: LayerDef = {
  id: 'radar',
  label: 'RADAR',
  pages: ['command', 'hazard', 'environment'],
  cluster: 'Weather & Atmosphere',
  defaultOn: true,
  raster: {
    tiles: [`${GEOMET}&LAYERS=RADAR_1KM_RRAI`],
    opacity: 0.75,
    refreshSec: 360, // new frame every 6 min (PT6M)
    attribution: ATTR,
  },
};

export const satelliteLayer: LayerDef = {
  id: 'satellite',
  label: 'SAT IR/VIS',
  pages: ['command', 'environment'],
  cluster: 'Weather & Atmosphere',
  defaultOn: false,
  raster: {
    tiles: [`${GEOMET}&LAYERS=GOES-West_1km_DayVis-NightIR`],
    opacity: 0.55,
    refreshSec: 600,
    attribution: ATTR,
  },
};

export const lightningLayer: LayerDef = {
  id: 'lightning',
  label: 'LIGHTNING',
  pages: ['command', 'hazard', 'environment'],
  cluster: 'Weather & Atmosphere',
  defaultOn: false,
  raster: {
    tiles: [`${GEOMET}&LAYERS=Lightning_2.5km_Density`],
    opacity: 0.8,
    refreshSec: 600, // PT10M density product (the licensed Blitzortung replacement, D9)
    attribution: ATTR,
  },
};
