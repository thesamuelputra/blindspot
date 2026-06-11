import { v } from 'convex/values';
import { internalAction, internalMutation, internalQuery } from '../_generated/server';
import { internal } from '../_generated/api';
import type { Severity } from './types';

// Auto-INTSUM (ARCHITECTURE §7.5, DECISIONS D4): every 4h (cron `intsum`,
// 14400s) plus on-demand, gather a compact operational snapshot and have
// claude-haiku-4-5 write a terse BLUF summary for the single operator.
// Stored in `intsums`; surfaced via convex/intsums.ts (COMMAND + ANALYST).
//
// Env: ANTHROPIC_API_KEY (Convex env). Missing key is a clean degrade: one
// clearly labeled "INTSUM unavailable" row per 24h, never a crash and never
// a row per cron tick. Transient API failures store nothing (next tick retries).
//
// Worst-case reads per run: <=4000 signals (6h window) + 50 alerts + 1 threat
// + full sources table (~60 rows) + <=1000 entities per mover kind (5 kinds).
// Worst-case writes: exactly 1 intsums row.

export const MODEL = 'claude-haiku-4-5';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const MAX_TOKENS = 600;

export const UNAVAILABLE_TEXT = 'INTSUM unavailable: ANTHROPIC_API_KEY not configured';
const UNAVAILABLE_REPEAT_MS = 24 * 3600_000; // one marker row per day, not per cron

export const SYSTEM_PROMPT = [
  'You are the intelligence summarizer for a single-operator OSINT console covering Vancouver Island, BC.',
  'Write an INTSUM from the JSON snapshot provided. Rules:',
  '- BLUF: lead with the single most important fact.',
  '- Terse and factual. No pleasantries, no preamble, no sign-off.',
  '- Plain language. Do not use em-dashes.',
  '- All timestamps in UTC.',
  '- Report only what the snapshot supports. No speculation. If you project, label it "projection".',
  '- Note degraded data sources if any are stale or down, since they limit confidence.',
  '- Maximum 180 words.',
].join('\n');

// ---- snapshot shape ----

export interface IntsumSnapshot {
  at: number;
  signalCounts6h: Record<string, number>;
  topSignals: Array<{ kind: string; title: string; severity: Severity; observedAt: number }>;
  activeAlerts: Array<{ headline: string; severity: Severity }>;
  threat: { level: string; score: number; computedAt: number } | null;
  sourceHealth: { live: number; stale: number; down: number; disabled: number };
  moverCounts: Record<string, number>;
}

// ---- pure helpers (exported for fixture tests) ----

const SEVERITY_RANK: Record<string, number> = { critical: 3, warning: 2, watch: 1, info: 0 };

export function rankSeverity(severity: string): number {
  return SEVERITY_RANK[severity] ?? 0;
}

export function countByKind(rows: Array<{ kind: string }>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.kind] = (counts[r.kind] ?? 0) + 1;
  return counts;
}

export function pickTopSignals<T extends { severity: string; observedAt: number }>(
  rows: T[],
  limit = 10,
): T[] {
  return [...rows]
    .sort((a, b) => rankSeverity(b.severity) - rankSeverity(a.severity) || b.observedAt - a.observedAt)
    .slice(0, limit);
}

export function utc(ms: number): string {
  // 2026-06-11T08:00Z, minute resolution, always UTC
  return new Date(ms).toISOString().slice(0, 16) + 'Z';
}

export function buildUserPrompt(snap: IntsumSnapshot): string {
  const lines: string[] = [];
  lines.push(`Snapshot time: ${utc(snap.at)}`);
  lines.push(
    snap.threat
      ? `Threat level: ${snap.threat.level} (score ${snap.threat.score.toFixed(1)}, computed ${utc(snap.threat.computedAt)})`
      : 'Threat level: not yet computed',
  );
  lines.push(
    `Source health: ${snap.sourceHealth.live} live, ${snap.sourceHealth.stale} stale, ${snap.sourceHealth.down} down, ${snap.sourceHealth.disabled} disabled`,
  );

  const movers = Object.entries(snap.moverCounts)
    .map(([k, n]) => `${k} ${n}`)
    .join(', ');
  lines.push(`Movers tracked (last 10 min): ${movers || 'none'}`);

  const counts = Object.entries(snap.signalCounts6h)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k} ${n}`)
    .join(', ');
  lines.push(`Signal counts (last 6h): ${counts || 'none'}`);

  lines.push('Active alerts:');
  if (snap.activeAlerts.length === 0) lines.push('  none');
  for (const a of snap.activeAlerts) lines.push(`  [${a.severity}] ${a.headline}`);

  lines.push('Top signals (by severity, then recency):');
  if (snap.topSignals.length === 0) lines.push('  none');
  for (const s of snap.topSignals)
    lines.push(`  [${s.severity}] ${s.kind}: ${s.title} (${utc(s.observedAt)})`);

  lines.push('');
  lines.push('Write the INTSUM now.');
  return lines.join('\n');
}

// Anthropic Messages API response: { content: [{type:"text", text}, ...], ... }.
// Tolerates unknown block types; returns '' when no text is present.
export function extractText(response: unknown): string {
  if (typeof response !== 'object' || response === null) return '';
  const content = (response as { content?: unknown }).content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    if (
      typeof block === 'object' &&
      block !== null &&
      (block as { type?: unknown }).type === 'text' &&
      typeof (block as { text?: unknown }).text === 'string'
    ) {
      parts.push((block as { text: string }).text);
    }
  }
  return parts.join('\n').trim();
}

// Once-per-day gate for the no-key marker row: skip when the newest intsum is
// already an unavailable marker younger than 24h.
export function shouldStoreUnavailable(
  newest: { at: number; text: string } | null,
  now: number,
): boolean {
  if (!newest) return true;
  if (!newest.text.startsWith('INTSUM unavailable')) return true;
  return now - newest.at >= UNAVAILABLE_REPEAT_MS;
}

// ---- convex functions ----

export const snapshot = internalQuery({
  args: {},
  handler: async (ctx): Promise<IntsumSnapshot> => {
    const now = Date.now();

    // signals, last 6h, bounded scan (newest first so the cap keeps recency)
    const recentSignals = await ctx.db
      .query('signals')
      .withIndex('by_observed', (q) => q.gte('observedAt', now - 6 * 3600_000))
      .order('desc')
      .take(4000);
    const signalCounts6h = countByKind(recentSignals);
    const topSignals = pickTopSignals(recentSignals, 10).map((s) => ({
      kind: s.kind,
      title: s.title,
      severity: s.severity,
      observedAt: s.observedAt,
    }));

    const alertRows = await ctx.db
      .query('alerts')
      .withIndex('by_status', (q) => q.eq('status', 'active'))
      .order('desc')
      .take(50);
    const activeAlerts = alertRows
      .filter((a) => !a.expires || a.expires > now)
      .map((a) => ({ headline: a.headline, severity: a.severity }));

    const threatRow = await ctx.db
      .query('threat')
      .withIndex('by_at')
      .order('desc')
      .first();
    const threat = threatRow
      ? { level: threatRow.level, score: threatRow.score, computedAt: threatRow.computedAt }
      : null;

    const sources = await ctx.db.query('sources').collect();
    const sourceHealth = { live: 0, stale: 0, down: 0, disabled: 0 };
    for (const s of sources) sourceHealth[s.status] += 1;

    const freshCutoff = now - 10 * 60_000;
    const moverCounts: Record<string, number> = {};
    for (const kind of ['aircraft', 'vessel', 'ferry', 'bus', 'balloon']) {
      const rows = await ctx.db
        .query('entities')
        .withIndex('by_kind', (q) => q.eq('kind', kind).gte('lastSeenAt', freshCutoff))
        .take(1000);
      if (rows.length > 0) moverCounts[kind] = rows.length;
    }

    return { at: now, signalCounts6h, topSignals, activeAlerts, threat, sourceHealth, moverCounts };
  },
});

export const store = internalMutation({
  args: {
    at: v.number(),
    text: v.string(),
    model: v.string(),
    snapshot: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert('intsums', args);
  },
});

export const storeUnavailable = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const newest = await ctx.db.query('intsums').withIndex('by_at').order('desc').first();
    if (!shouldStoreUnavailable(newest, now)) return;
    await ctx.db.insert('intsums', { at: now, text: UNAVAILABLE_TEXT, model: 'none' });
  },
});

// Cron every 4h (cron `intsum`) and callable on demand from the client's
// regenerate action path. Direct fetch to the Anthropic Messages API per
// DECISIONS D4 (default Convex runtime, no SDK dependency).
export const generate = internalAction({
  args: {},
  handler: async (ctx) => {
    const snap = (await ctx.runQuery(internal.brain.intsum.snapshot, {})) as IntsumSnapshot;

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      await ctx.runMutation(internal.brain.intsum.storeUnavailable, {});
      return;
    }

    let res: Response;
    try {
      res = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: buildUserPrompt(snap) }],
        }),
      });
    } catch (e) {
      console.error('intsum: Anthropic API unreachable:', e);
      return; // transient; next cron retries
    }
    if (!res.ok) {
      console.error(`intsum: Anthropic API ${res.status}: ${(await res.text()).slice(0, 500)}`);
      return; // transient or config error; logged, next cron retries
    }

    const text = extractText(await res.json());
    if (!text) {
      console.error('intsum: response contained no text blocks');
      return;
    }

    await ctx.runMutation(internal.brain.intsum.store, {
      at: Date.now(),
      text,
      model: MODEL,
      snapshot: JSON.stringify(snap),
    });
  },
});
