import { v } from 'convex/values';
import { internalAction, internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';

// Alerting pipeline (ARCHITECTURE §7.6): edge-triggered, severity-tiered.
// Channels: ntfy (keyless fetch, here) + web push (brain/push.ts, "use node",
// Phase 4 wave) + client toasts/TTS via reactive unacked-notifications query.

// Re-fire windows for a CONTINUING condition (first occurrence always fires).
const REFIRE_MS: Record<string, number> = {
  info: 6 * 3600_000,
  watch: 3600_000,
  warning: 15 * 60_000,
  critical: 10 * 60_000,
};

// Per-tier hourly caps (critical uncapped).
const HOURLY_CAP: Record<string, number> = { info: 4, watch: 12, warning: 30, critical: 9999 };

export const notify = internalAction({
  args: {
    severity: v.string(),
    title: v.string(),
    body: v.string(),
    dedupeKey: v.string(),
    signalId: v.optional(v.id('signals')),
  },
  handler: async (ctx, args) => {
    const decision = (await ctx.runMutation(internal.brain.alerting.record, args)) as {
      send: boolean;
      channels: string[];
    };
    if (!decision.send) return;

    const topic = process.env.NTFY_TOPIC;
    if (topic) {
      try {
        await fetch(`https://ntfy.sh/${topic}`, {
          method: 'POST',
          headers: {
            Title: args.title.replace(/[^\x20-\x7E]/g, ' ').slice(0, 120),
            Priority: args.severity === 'critical' ? 'urgent' : args.severity === 'warning' ? 'high' : 'default',
            Tags: args.severity,
          },
          body: args.body.slice(0, 1000),
        });
      } catch (e) {
        console.error('ntfy send failed:', e);
      }
    }
    // web push fan-out joins here via internal.brain.push (Phase 4 wave)
  },
});

export const record = internalMutation({
  args: {
    severity: v.string(),
    title: v.string(),
    body: v.string(),
    dedupeKey: v.string(),
    signalId: v.optional(v.id('signals')),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const refire = REFIRE_MS[args.severity] ?? 3600_000;

    const prior = await ctx.db
      .query('notifications')
      .withIndex('by_dedupe', (q) => q.eq('dedupeKey', args.dedupeKey).gte('at', now - refire))
      .first();
    if (prior) return { send: false, channels: [] };

    const hourAgo = now - 3600_000;
    const recent = await ctx.db
      .query('notifications')
      .withIndex('by_at', (q) => q.gte('at', hourAgo))
      .collect();
    const tierCount = recent.filter((n) => n.severity === args.severity).length;
    if (tierCount >= (HOURLY_CAP[args.severity] ?? 12)) return { send: false, channels: [] };

    await ctx.db.insert('notifications', {
      at: now,
      severity: args.severity as 'info' | 'watch' | 'warning' | 'critical',
      title: args.title,
      body: args.body,
      channels: ['ntfy'],
      dedupeKey: args.dedupeKey,
      ack: false,
      signalId: args.signalId,
    });
    return { send: true, channels: ['ntfy'] };
  },
});
