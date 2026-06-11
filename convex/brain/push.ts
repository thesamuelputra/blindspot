'use node';

import { v } from 'convex/values';
import { internalAction } from '../_generated/server';
import { internal } from '../_generated/api';
import webpush from 'web-push';

// Web push channel (ARCHITECTURE §7.6, DECISIONS D5). Lives in its own
// "use node" file because web-push needs Node crypto and runtimes can't mix.
// Env-gated: without VAPID keys in the Convex env this is a clean no-op.
// Keys come from `npx web-push generate-vapid-keys`, stored as
// VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT (mailto: or https: URL).
//
// The helpers below are pure and exported for fixture tests
// (convex/brain/__tests__/push.test.ts).

export interface VapidConfig {
  subject: string;
  publicKey: string;
  privateKey: string;
}

/** Read VAPID config from an env map. Null when any of the three is missing. */
export function vapidFromEnv(env: Record<string, string | undefined>): VapidConfig | null {
  const publicKey = env.VAPID_PUBLIC_KEY;
  const privateKey = env.VAPID_PRIVATE_KEY;
  const subject = env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return null;
  return { subject, publicKey, privateKey };
}

/**
 * JSON payload the (Phase 5) service worker will render. Title and body are
 * truncated so the encrypted payload stays well under the 4KB push limit.
 */
export function buildPushPayload(args: {
  title: string;
  body: string;
  severity: string;
  at?: number;
}): string {
  return JSON.stringify({
    title: args.title.slice(0, 120),
    body: args.body.slice(0, 1000),
    severity: args.severity,
    at: args.at ?? Date.now(),
  });
}

/** 404/410 from the push service means the subscription is gone for good. */
export function isGoneStatus(statusCode: number | undefined): boolean {
  return statusCode === 404 || statusCode === 410;
}

/** Per-severity delivery options for the push service. */
export function pushOptionsFor(severity: string): { TTL: number; urgency: 'high' | 'normal' } {
  const urgent = severity === 'warning' || severity === 'critical';
  // Urgent alerts should wake the device but go stale fast; hold them for
  // at most an hour. Lower tiers can wait for the device to come online.
  return { TTL: urgent ? 3600 : 4 * 3600, urgency: urgent ? 'high' : 'normal' };
}

/**
 * Fan a notification out to every registered push subscription.
 * Scheduled from brain/alerting.ts notify for warning/critical; the
 * edge-trigger and rate limits already happened there, so this just sends.
 */
export const sendToAll = internalAction({
  args: {
    title: v.string(),
    body: v.string(),
    severity: v.string(),
  },
  handler: async (ctx, args) => {
    const vapid = vapidFromEnv(process.env);
    if (!vapid) {
      console.log(
        'web push disabled: set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT in the Convex env to enable it',
      );
      return { sent: 0, removed: 0, skipped: true };
    }
    webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);

    const subs = await ctx.runQuery(internal.pushSubscriptions.listAll, {});
    if (subs.length === 0) return { sent: 0, removed: 0, skipped: false };

    const payload = buildPushPayload(args);
    const options = pushOptionsFor(args.severity);
    let sent = 0;
    let removed = 0;

    for (const sub of subs) {
      let keys: { p256dh: string; auth: string };
      try {
        keys = JSON.parse(sub.keys) as { p256dh: string; auth: string };
      } catch {
        // Corrupt row (subscribe validates, so this is legacy/manual data); prune it.
        await ctx.runMutation(internal.pushSubscriptions.removeByEndpoint, {
          endpoint: sub.endpoint,
        });
        removed++;
        continue;
      }
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys }, payload, options);
        sent++;
        await ctx.runMutation(internal.pushSubscriptions.markDelivered, {
          endpoint: sub.endpoint,
        });
      } catch (e) {
        const statusCode = (e as { statusCode?: number }).statusCode;
        if (isGoneStatus(statusCode)) {
          // Subscription expired or unsubscribed at the push service; prune it.
          await ctx.runMutation(internal.pushSubscriptions.removeByEndpoint, {
            endpoint: sub.endpoint,
          });
          removed++;
        } else {
          console.error(`web push send failed (${statusCode ?? 'no status'}):`, e);
        }
      }
    }
    return { sent, removed, skipped: false };
  },
});
