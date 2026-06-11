import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

// Static cron registry (Convex requirement). Cadences per DECISIONS D8:
// fast 90–120s / medium 5–15m / slow 30–60m+. Periods are deliberately
// staggered (121s, 127s…) so lanes don't tick in synchronized bursts.
const crons = cronJobs();

// ---- fast lane ----
crons.interval('usgs-quakes', { seconds: 121 }, internal.feeds.usgsQuakes.sync, {});

export default crons;
