import type { LayerDef } from '../types';

// nasa-gibs — SOURCES.md: Environment & Conditions. NASA GIBS WMTS true-color
// imagery, CORS * (verified), loaded browser-direct as a MapLibre raster
// source; no Convex feed module. REST path order is TileMatrix/TileRow/TileCol
// = {z}/{y}/{x}, NOT z/x/y. Daily product with a same-day lag (VI overpass is
// mid-afternoon local), so the date is pinned to *yesterday* UTC at module
// load — guaranteed coverage, refreshed on next app load. The trailing '?'
// keeps MapShell's '&_t=' cache-bust a valid query string on an otherwise
// query-less REST URL (verified 200 with '?&_t='). GoogleMapsCompatible_Level9
// caps at z9: tiles 404 (render empty) past that zoom — island-scale only.
const DATE = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10);

const GIBS =
  'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/' +
  `VIIRS_SNPP_CorrectedReflectance_TrueColor/default/${DATE}/` +
  'GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg?';

// Only the true-color layer ships: SOURCES.md verified VIIRS SNPP (and the
// MODIS Terra alternate) only — no thermal/fires GIBS product was verified.
export const gibsTruecolorLayer: LayerDef = {
  id: 'gibs-truecolor',
  label: 'EARTH IMG',
  pages: ['command', 'environment'],
  cluster: 'Environment & Conditions',
  defaultOn: false,
  raster: {
    tiles: [GIBS],
    tileSize: 256,
    opacity: 0.8,
    // no refreshSec: the imagery for a pinned date never changes
    attribution: 'NASA GIBS / Worldview',
  },
};
