import { cronJobs } from 'convex/server';

// Static cron registry (Convex requirement). Feed lanes land here in Phase 3,
// the 120s brain tick in Phase 4 — cadences per DECISIONS D8.
const crons = cronJobs();

export default crons;
