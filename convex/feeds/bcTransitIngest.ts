import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { upsertMovers, type MoverInput } from '../lib/movers';
import {
  upsertSignals,
  reportSuccess,
  reportFailure,
  type SignalInput,
  type SourceMeta,
} from '../lib/ingest';

// bc-transit ingest — default-runtime half of the feed (the sync action needs
// gtfs-realtime-bindings and lives in feeds/bcTransit.ts under "use node";
// runtimes can't mix in one file). Movers kind 'bus' (Victoria Regional),
// service alerts as signals kind 'transit-alert'.
const META: SourceMeta = {
  slug: 'bc-transit',
  name: 'BC Transit GTFS-RT (Victoria)',
  cluster: 'Ground (Mobility)',
  cadenceSec: 120,
  // Required by BC Transit Open Data Terms of Use: identify BC Transit as source
  attribution: 'BC Transit',
  licenseNote: 'BC Transit Open Data Terms of Use (revocable; source attribution required)',
};

export const ingest = internalMutation({
  args: { movers: v.array(v.any()), signals: v.array(v.any()) },
  handler: async (ctx, { movers, signals }) => {
    const count = await upsertMovers(ctx, 'bus', META.slug, movers as MoverInput[]);
    await upsertSignals(ctx, signals as SignalInput[]);
    await reportSuccess(ctx, META, count);
  },
});

export const fail = internalMutation({
  args: { error: v.string() },
  handler: async (ctx, { error }) => {
    await reportFailure(ctx, META, error);
  },
});
