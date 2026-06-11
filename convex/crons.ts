import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

// Static cron registry (Convex requirement). Cadences per DECISIONS D8:
// fast 90–120s / medium 5–15m / slow 30–60m+. Periods are deliberately
// staggered (121s, 127s…) so lanes don't tick in synchronized bursts.
const crons = cronJobs();

// ---- fast lane (90–120s, D8: alert-grade feeds only) ----
crons.interval('usgs-quakes', { seconds: 121 }, internal.feeds.usgsQuakes.sync, {});
crons.interval('eccc-weather-alerts', { seconds: 113 }, internal.feeds.ecccAlerts.sync, {});
crons.interval('ntwc-tsunami', { seconds: 119 }, internal.feeds.ntwcTsunami.sync, {});
crons.interval('naad-pelmorex', { seconds: 107 }, internal.feeds.naadPelmorex.sync, {});
crons.interval('adsb-aircraft', { seconds: 127 }, internal.feeds.adsbAircraft.sync, {});

// ---- medium lane ----
crons.interval('nrcan-quakes', { seconds: 240 }, internal.feeds.nrcanQuakes.sync, {});
crons.interval('bchydro-outages', { seconds: 300 }, internal.feeds.bchydroOutages.sync, {});
crons.interval('drivebc-open511', { seconds: 307 }, internal.feeds.drivebcEvents.sync, {});
crons.interval('bcws-fires', { seconds: 900 }, internal.feeds.bcwsFires.sync, {});
crons.interval('bc-evac-orders', { seconds: 911 }, internal.feeds.bcEvacOrders.sync, {});

// ---- slow lane ----
crons.interval('pnsn-tremor', { seconds: 1801 }, internal.feeds.pnsnTremor.sync, {});
crons.interval('cwfis-hotspots', { seconds: 1811 }, internal.feeds.cwfisHotspots.sync, {});
crons.interval('nasa-firms', { seconds: 1831 }, internal.feeds.nasaFirms.sync, {});

export default crons;
