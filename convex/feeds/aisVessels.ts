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

// AIS ship-type number → marker category (ITU-R M.1371 type groups).
function vesselCat(shipType: number | undefined): string {
  if (shipType == null) return 'vessel';
  if (shipType === 30) return 'fishing';
  if (shipType === 31 || shipType === 32 || shipType === 52) return 'tug';
  if (shipType === 35) return 'military';
  if (shipType === 36 || shipType === 37) return 'pleasure';
  if (shipType >= 50 && shipType <= 55) return 'tug'; // pilot/SAR/port tenders
  if (shipType >= 60 && shipType <= 69) return 'passenger';
  if (shipType >= 70 && shipType <= 79) return 'cargo';
  if (shipType >= 80 && shipType <= 89) return 'tanker';
  return 'vessel';
}

export const ingest = internalMutation({
  args: { vessels: v.array(v.any()) },
  handler: async (ctx, { vessels }) => {
    // stamp marker identity from the worker's state JSON (shipType)
    const movers = (vessels as MoverInput[]).map((m) => {
      let shipType: number | undefined;
      try {
        shipType = m.state ? (JSON.parse(m.state) as { shipType?: number }).shipType : undefined;
      } catch {
        /* keep undefined */
      }
      return { ...m, cat: vesselCat(shipType) };
    });
    const count = await upsertMovers(ctx, 'vessel', META.slug, movers);
    await reportSuccess(ctx, META, count);
  },
});

// Watchdog (ARCHITECTURE §6 + AUDIT Phase 6): the source registers only on
// first worker ingest, so an undeployed/dead worker was invisible on SYSTEM.
// A 5-min cron keeps the row honest.
export const watchdog = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const row = await ctx.db
      .query('sources')
      .withIndex('by_slug', (q) => q.eq('slug', META.slug))
      .unique();
    if (!row) {
      await ctx.db.insert('sources', {
        ...META,
        status: 'down',
        consecutiveFailures: 0,
        lastError: 'AIS worker not running (deploy workers/ais — see RUNBOOK)',
      });
      return;
    }
    if (row.status === 'live' && (row.lastSuccessAt ?? 0) < now - 5 * 60_000) {
      await ctx.db.patch(row._id, {
        status: 'stale',
        lastError: 'no worker batches for 5+ min',
      });
    }
  },
});
