import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { upsertMovers, type MoverInput } from '../lib/movers';
import { reportSuccess, type SourceMeta } from '../lib/ingest';

// aisstream — STREAM-fed (no cron): the workers/ais process holds the
// websocket and batch-POSTs to /ingest/ais every 30s (ARCHITECTURE §6).
// Health: each batch marks the source live; the Phase 4 brain watchdog flags
// stale when no batch lands for 5 min. Worst case ~300 vessels/batch.
const META: SourceMeta = {
  slug: 'aisstream',
  name: 'AIS (aisstream.io via worker)',
  cluster: 'Seas (Marine)',
  cadenceSec: 30,
  attribution: 'AIS data via aisstream.io',
  licenseNote: 'aisstream.io beta — no SLA; worker reconnects with backoff',
};

export const ingest = internalMutation({
  args: { vessels: v.array(v.any()) },
  handler: async (ctx, { vessels }) => {
    const count = await upsertMovers(ctx, 'vessel', META.slug, vessels as MoverInput[]);
    await reportSuccess(ctx, META, count);
  },
});
