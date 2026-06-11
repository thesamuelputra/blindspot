import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

// Static cron registry (Convex requirement). Cadences per DECISIONS D8:
// fast 90–120s / medium 5–15m / slow 30–60m+. Periods are deliberately
// staggered (121s, 127s…) so lanes don't tick in synchronized bursts.
const crons = cronJobs();

// ---- the brain (single batched tick — ARCHITECTURE §5/§7, D8) ----
crons.interval('brain-tick', { seconds: 120 }, internal.brain.evaluate.evaluate, {});

// ---- fast lane (90–120s, D8: alert-grade feeds only) ----
crons.interval('usgs-quakes', { seconds: 121 }, internal.feeds.usgsQuakes.sync, {});
crons.interval('eccc-weather-alerts', { seconds: 113 }, internal.feeds.ecccAlerts.sync, {});
crons.interval('ntwc-tsunami', { seconds: 119 }, internal.feeds.ntwcTsunami.sync, {});
crons.interval('naad-pelmorex', { seconds: 107 }, internal.feeds.naadPelmorex.sync, {});
crons.interval('adsb-aircraft', { seconds: 127 }, internal.feeds.adsbAircraft.sync, {});
crons.interval('bc-transit', { seconds: 131 }, internal.feeds.bcTransit.sync, {});

// ---- medium lane ----
crons.interval('nrcan-quakes', { seconds: 240 }, internal.feeds.nrcanQuakes.sync, {});
crons.interval('bc-ferries', { seconds: 293 }, internal.feeds.bcFerries.sync, {});
crons.interval('noaa-swpc', { seconds: 311 }, internal.feeds.noaaSwpc.sync, {});
crons.interval('dfo-tides', { seconds: 601 }, internal.feeds.dfoTides.sync, {});
crons.interval('uvic-mesh', { seconds: 607 }, internal.feeds.uvicMesh.sync, {});
crons.interval('onc-oceans', { seconds: 613 }, internal.feeds.oncOceans.sync, {});
crons.interval('eccc-aqhi', { seconds: 901 }, internal.feeds.ecccAqhi.sync, {});
crons.interval('ndbc-buoys', { seconds: 907 }, internal.feeds.ndbcBuoys.sync, {});
crons.interval('eccc-hydrometric', { seconds: 919 }, internal.feeds.ecccHydrometric.sync, {});
crons.interval('eccc-conditions', { seconds: 929 }, internal.feeds.ecccConditions.sync, {});
crons.interval('open-meteo', { seconds: 937 }, internal.feeds.openMeteo.sync, {});
crons.interval('sondehub', { seconds: 599 }, internal.feeds.sondehub.sync, {});
crons.interval('news-rss', { seconds: 941 }, internal.feeds.newsRss.sync, {});
crons.interval('nws-adjacent-waters', { seconds: 313 }, internal.feeds.nwsAdjacentWaters.sync, {});
crons.interval('emergencyinfobc', { seconds: 617 }, internal.feeds.emergencyInfoBc.sync, {});
crons.interval('ioda', { seconds: 907 }, internal.feeds.ioda.sync, {});
crons.interval('social-pulse', { seconds: 947 }, internal.feeds.socialPulse.sync, {});
crons.interval('gdelt', { seconds: 953 }, internal.feeds.gdelt.sync, {});
crons.interval('bchydro-outages', { seconds: 300 }, internal.feeds.bchydroOutages.sync, {});
crons.interval('drivebc-open511', { seconds: 307 }, internal.feeds.drivebcEvents.sync, {});
crons.interval('bcws-fires', { seconds: 900 }, internal.feeds.bcwsFires.sync, {});
crons.interval('bc-evac-orders', { seconds: 911 }, internal.feeds.bcEvacOrders.sync, {});

// ---- slow lane ----
crons.interval('pnsn-tremor', { seconds: 1801 }, internal.feeds.pnsnTremor.sync, {});
crons.interval('cwfis-hotspots', { seconds: 1811 }, internal.feeds.cwfisHotspots.sync, {});
crons.interval('nasa-firms', { seconds: 1831 }, internal.feeds.nasaFirms.sync, {});
crons.interval('drivebc-cams', { seconds: 3607 }, internal.feeds.drivebcCams.sync, {});
crons.interval('bc-rfc-advisories', { seconds: 3613 }, internal.feeds.bcRfcAdvisories.sync, {});
crons.interval('launch-library', { seconds: 3617 }, internal.feeds.launchLibrary.sync, {});
crons.interval('msc-marine-text', { seconds: 1813 }, internal.feeds.mscMarineText.sync, {});
crons.interval('ripestat', { seconds: 1801 }, internal.feeds.ripestat.sync, {});
crons.interval('cloudflare-radar', { seconds: 1861 }, internal.feeds.cloudflareRadar.sync, {});
crons.interval('gdacs', { seconds: 1867 }, internal.feeds.gdacs.sync, {});
crons.interval('purpleair', { seconds: 1847 }, internal.feeds.purpleair.sync, {});
crons.interval('openaq', { seconds: 1873 }, internal.feeds.openaq.sync, {});
crons.interval('ccg-notship', { seconds: 3637 }, internal.feeds.ccgNotship.sync, {});
crons.interval('dfo-lightstations', { seconds: 3659 }, internal.feeds.dfoLightstations.sync, {});
crons.interval('abusech', { seconds: 3631 }, internal.feeds.abusech.sync, {});
crons.interval('orcasound', { seconds: 3643 }, internal.feeds.orcasound.sync, {});
crons.interval('gpsjam', { seconds: 21601 }, internal.feeds.gpsjam.sync, {});
crons.interval('sst-erddap', { seconds: 21611 }, internal.feeds.sstErddap.sync, {});
crons.interval('avalanche-canada', { seconds: 21617 }, internal.feeds.avalancheCanada.sync, {});
crons.interval('bc-drought', { seconds: 43201 }, internal.feeds.bcDrought.sync, {});
crons.interval('bc-snow', { seconds: 21619 }, internal.feeds.bcSnow.sync, {});
crons.interval('bc-parks', { seconds: 21631 }, internal.feeds.bcParks.sync, {});
crons.interval('who-outbreaks', { seconds: 21647 }, internal.feeds.whoOutbreaks.sync, {});
crons.interval('celestrak', { seconds: 86401 }, internal.feeds.celestrak.sync, {});
crons.interval('nasa-neo', { seconds: 86411 }, internal.feeds.nasaNeo.sync, {});
crons.interval('dfo-closures', { seconds: 86417 }, internal.feeds.dfoClosures.sync, {});
crons.interval('open-charge-map', { seconds: 86423 }, internal.feeds.openChargeMap.sync, {});
crons.interval('permits', { seconds: 86441 }, internal.feeds.permits.sync, {});
crons.interval('bccdc-wastewater', { seconds: 86461 }, internal.feeds.bccdcWastewater.sync, {});
crons.interval('gac-travel', { seconds: 86467 }, internal.feeds.gacTravel.sync, {});
crons.interval('extra-cams', { seconds: 86477 }, internal.feeds.extraCams.sync, {});

export default crons;
