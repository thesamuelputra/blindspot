import { v } from 'convex/values';
import { mutation, internalMutation, internalQuery } from './_generated/server';

// Web push subscription registry (ARCHITECTURE §7.6, DECISIONS D5).
// Client (Phase 5 service worker) registers a PushSubscription here; the
// sender (brain/push.ts, "use node") reads listAll and prunes dead endpoints
// via removeByEndpoint when the push service answers 404/410.

/** Upsert a browser push subscription, keyed by its endpoint URL. */
export const subscribe = mutation({
  args: {
    endpoint: v.string(),
    keys: v.string(), // JSON {p256dh, auth} straight from PushSubscription.toJSON().keys
  },
  handler: async (ctx, { endpoint, keys }) => {
    if ((await ctx.auth.getUserIdentity()) === null) throw new Error('unauthenticated');

    // Validate the keys blob now so the sender never trips on a corrupt row.
    let parsed: { p256dh?: unknown; auth?: unknown };
    try {
      parsed = JSON.parse(keys) as { p256dh?: unknown; auth?: unknown };
    } catch {
      throw new Error('keys must be a JSON object with p256dh and auth');
    }
    if (typeof parsed.p256dh !== 'string' || typeof parsed.auth !== 'string') {
      throw new Error('keys must be a JSON object with p256dh and auth');
    }

    const existing = await ctx.db
      .query('pushSubscriptions')
      .withIndex('by_endpoint', (q) => q.eq('endpoint', endpoint))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { keys });
      return existing._id;
    }
    return await ctx.db.insert('pushSubscriptions', { endpoint, keys, createdAt: Date.now() });
  },
});

/** Remove a subscription (client opt-out or permission revoked). */
export const unsubscribe = mutation({
  args: { endpoint: v.string() },
  handler: async (ctx, { endpoint }) => {
    if ((await ctx.auth.getUserIdentity()) === null) throw new Error('unauthenticated');
    const existing = await ctx.db
      .query('pushSubscriptions')
      .withIndex('by_endpoint', (q) => q.eq('endpoint', endpoint))
      .unique();
    if (existing) await ctx.db.delete(existing._id);
    return existing !== null;
  },
});

/** All subscriptions, for the sender fan-out. Internal only. */
export const listAll = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query('pushSubscriptions').collect();
  },
});

/** Prune a dead endpoint (push service answered 404/410, or corrupt keys). */
export const removeByEndpoint = internalMutation({
  args: { endpoint: v.string() },
  handler: async (ctx, { endpoint }) => {
    const existing = await ctx.db
      .query('pushSubscriptions')
      .withIndex('by_endpoint', (q) => q.eq('endpoint', endpoint))
      .unique();
    if (existing) await ctx.db.delete(existing._id);
  },
});

/** Stamp a successful delivery so SYSTEM can show per-device push health. */
export const markDelivered = internalMutation({
  args: { endpoint: v.string() },
  handler: async (ctx, { endpoint }) => {
    const existing = await ctx.db
      .query('pushSubscriptions')
      .withIndex('by_endpoint', (q) => q.eq('endpoint', endpoint))
      .unique();
    if (existing) await ctx.db.patch(existing._id, { lastOkAt: Date.now() });
  },
});
