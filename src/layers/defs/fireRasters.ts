import type { LayerDef } from '../types';

// Wildfire raster overlays — both hosts are CORS-open (verified in SOURCES.md
// and re-probed 2026-06-11: 200 image/png on EPSG:3857 GetMap over VI), loaded
// browser-direct as MapLibre raster sources; no Convex feed module needed.
// Same shape as geometRasters.ts: WMS GetMap with {bbox-epsg-3857} tiles.

// CWFIS Fire Danger Rating (fdr_current) — one model run per day. Required
// citation per the CWFIS licence: 'Canadian Forest Service. Canadian Wildland
// Fire Information System (CWFIS), Natural Resources Canada, Canadian Forest
// Service, Northern Forestry Centre, Edmonton, Alberta.
// https://cwfis.cfs.nrcan.gc.ca.' (full string lives here; the map chip shows
// the short form below).
const CWFIS_WMS =
  'https://cwfis.cfs.nrcan.gc.ca/geoserver/public/wms?service=WMS&version=1.3.0&request=GetMap' +
  '&crs=EPSG:3857&bbox={bbox-epsg-3857}&width=256&height=256&format=image/png&transparent=true&styles=';

const GEOMET =
  'https://geo.weather.gc.ca/geomet?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap' +
  '&CRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=256&HEIGHT=256&FORMAT=image/png&TRANSPARENT=true';

export const fireDangerLayer: LayerDef = {
  id: 'fire-danger',
  label: 'FIRE DANGER',
  pages: ['command', 'hazard'],
  cluster: 'Wildfire',
  defaultOn: false,
  raster: {
    tiles: [`${CWFIS_WMS}&layers=public:fdr_current`],
    opacity: 0.55,
    refreshSec: 21600, // daily model run; 6h re-bust is plenty
    attribution: 'Natural Resources Canada (CWFIS)',
  },
};

// ECCC RAQDPS wildfire smoke plume (surface PM2.5). The legacy FireWork
// RAQDPS-FW.SFC_PM2.5 layer is gone — the 2025-2026 GeoMet rename moved
// operational smoke to RAQDPS.*-WildfireSmokePlume (SOURCES.md firesmoke
// entry). Transparent tile when no smoke is forecast.
export const smokeLayer: LayerDef = {
  id: 'smoke',
  label: 'SMOKE',
  pages: ['command', 'hazard', 'environment'],
  cluster: 'Wildfire',
  defaultOn: false,
  raster: {
    tiles: [`${GEOMET}&LAYERS=RAQDPS.Sfc_PM2.5-WildfireSmokePlume`],
    opacity: 0.6,
    refreshSec: 3600, // 2 model runs/day with hourly timesteps; hourly re-bust
    attribution: 'Data Source: Environment and Climate Change Canada',
  },
};
