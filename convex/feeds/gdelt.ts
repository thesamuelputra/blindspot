import { v } from 'convex/values';
import { internalAction, internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { fetchSource } from '../lib/fetchSource';
import {
  upsertSignals,
  reportSuccess,
  reportFailure,
  type SourceMeta,
  type SignalInput,
} from '../lib/ingest';

// gdelt — SOURCES.md: World Mode (Global). GDELT DOC 2.0 API, no auth.
// Two artlist queries per sync, SERIALIZED with >=6s spacing (GDELT enforces
// a HARD 1-request-per-5-seconds-per-IP limit; the 429 body is plain text,
// verified live at build time 2026-06-11):
//   (a) VI pulse: query "Vancouver Island" (the phrase query IS the VI
//       filter — no bbox, items are not geocoded, BRIEF rule: no geocoder
//       at ingest) → kind 'news', cap 25, expiresAt +7d.
//   (b) world pulse: (theme:ARMEDCONFLICT OR theme:NATURAL_DISASTER) over
//       the last 24h → kind 'world-event', cap 50, expiresAt +48h. Kind
//       'world-event' is exempt from the VI bbox filter by definition
//       (ARCHITECTURE §4) — these are deliberately global records. Both
//       theme names verified against the official GKG theme lookup
//       (data.gdeltproject.org/api/v2/guides/LOOKUP-GKGTHEMES.TXT).
// GEO 2.0 was re-verified at build time and still hard-404s on GDELT's own
// documented path (matches the catalog's verify-failed flag), so the world
// pulse uses DOC artlist. DOC artlist carries NO coordinates, so both kinds
// ship as non-geographic signals (no lat/lng/cell) — "lat/lng from GDELT geo
// when present" resolves to absent until GEO resurfaces.
//
// Severity mapping: the artlist response has no severity field — every
// record is ambient 'info' (headlines; escalation is the brain's job).
// Confidence 0.6: GDELT is the canonical aggregated/modeled example in
// ARCHITECTURE §4. dedupeKey 'gdelt:<djb2 hex of url>' — the article URL is
// the only stable cross-poll id; a story matched by both queries dedupes to
// whichever kind landed first (upsert never rewrites kind).
//
// Verified response quirks handled here (SOURCES.md):
//   - errors come back as text/plain or HTML, sometimes with HTTP 200 —
//     check status + Content-Type and lenient-parse inside try/catch; a
//     malformed body is a feed failure, never a crash;
//   - DOC bodies can contain unescaped control chars — strip before parse;
//   - seendate is 'YYYYMMDDTHHMMSSZ' (no dashes/colons — custom parser);
//   - titles carry stray spaces around punctuation ('B . C . Ferries');
//   - artlist default sort is relevance — &sort=datedesc on both queries;
//   - 429 → one long retry after 6.5s (verified pattern: first call 429s,
//     6s-spaced retry returns 200). fetchSource's built-in jitter retry is
//     too fast for this limiter, so retries:0 + our own spacing.
// Health: one 'gdelt' row; per-query isolation, failure only when BOTH
// queries fail this sync (newsRss >half-failed convention). Results are
// server-cached 15 min (Cache-Control: public, max-age=900).
// Worst case 25 + 50 = 75 records/sync. Cadence: medium lane (900s — polling
// faster than the 15-min server cache returns identical data).
const META: SourceMeta = {
  slug: 'gdelt',
  name: 'GDELT DOC 2.0 (news pulse)',
  cluster: 'World Mode (Global)',
  cadenceSec: 900,
  attribution: 'Data from the GDELT Project (gdeltproject.org)',
  licenseNote: 'Open for unlimited use with attribution (gdeltproject.org/about.html)',
};

const DOC_API = 'https://api.gdeltproject.org/api/v2/doc/doc';
const RATE_SPACING_MS = 6500; // >=6s between ANY two GDELT calls (incl. retry)
const VI_CAP = 25;
const WORLD_CAP = 50;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const TWO_DAYS_MS = 48 * 60 * 60 * 1000;

const VI_URL =
  `${DOC_API}?query=${encodeURIComponent('"Vancouver Island"')}` +
  `&mode=artlist&format=json&maxrecords=${VI_CAP}&sort=datedesc`;
const WORLD_URL =
  `${DOC_API}?query=${encodeURIComponent('(theme:ARMEDCONFLICT OR theme:NATURAL_DISASTER)')}` +
  `&mode=artlist&format=json&maxrecords=${WORLD_CAP}&sort=datedesc&timespan=1d`;

interface GdeltArticle {
  url?: string;
  url_mobile?: string;
  title?: string;
  seendate?: string; // 'YYYYMMDDTHHMMSSZ'
  socialimage?: string;
  domain?: string;
  language?: string;
  sourcecountry?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// djb2 over the article url, rendered as uint32 hex — content hash behind
// dedupeKey 'gdelt:<hash>' (same hash family as newsRss; different prefix,
// so GDELT records never collide with the RSS sweep's).
function djb2hex(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

// 'YYYYMMDDTHHMMSSZ' → epoch ms (no dashes/colons, so Date.parse chokes).
function parseSeendate(s: string | undefined, fallback: number): number {
  if (!s) return fallback;
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s.trim());
  if (!m) return fallback;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  return Number.isNaN(ms) ? fallback : ms;
}

// GDELT titles arrive with stray spaces around punctuation ('B . C . Ferries',
// 'FIFA 2026 : Here a list…') — collapse space-before-punctuation and rejoin
// spaced-out initialisms, then squash whitespace.
function cleanTitle(s: string): string {
  return s
    .replace(/\s+([.,:;!?%)\]])/g, '$1')
    .replace(/([([])\s+/g, '$1')
    .replace(/\b([A-Z])\.\s+(?=[A-Z]\.)/g, '$1.')
    .replace(/\s+/g, ' ')
    .trim();
}

// One GDELT call: descriptive UA (gated source — fetchSource supplies it),
// no fast retries; on the documented 429 throw, wait out the limiter once
// and try again. Lenient body handling per SOURCES.md: status + Content-Type
// checked before parse, control chars stripped, parse failure = feed failure.
async function gdeltArticles(url: string, label: string): Promise<GdeltArticle[]> {
  let res: Response;
  try {
    res = await fetchSource(url, { retries: 0 });
  } catch {
    await sleep(RATE_SPACING_MS); // 429/transient — one limiter-paced retry
    res = await fetchSource(url, { retries: 0 });
  }
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status}`);
  const text = await res.text();
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('json')) {
    // 200 + text/plain (or text/html) is GDELT's error envelope
    throw new Error(`${label}: non-JSON response — ${text.slice(0, 160)}`);
  }
  let body: unknown;
  try {
    // DOC bodies occasionally carry unescaped control chars — replace the
    // whole JSON-string-illegal control range with spaces before parsing (a
    // space is valid both inside strings and between tokens; raw \t/\n/\r
    // inside a string fail JSON.parse just like the rest of the range).
    // eslint-disable-next-line no-control-regex
    body = JSON.parse(text.replace(/[\u0000-\u001F]/g, ' '));
  } catch (e) {
    throw new Error(`${label}: malformed JSON — ${String(e)}`);
  }
  const articles = (body as { articles?: unknown }).articles;
  return Array.isArray(articles) ? (articles as GdeltArticle[]) : [];
}

function toSignals(
  articles: GdeltArticle[],
  opts: {
    kind: 'news' | 'world-event';
    cap: number;
    ttlMs: number;
    queryUrl: string;
    fetchedAt: number;
    seen: Set<string>;
  },
): SignalInput[] {
  const signals: SignalInput[] = [];
  for (const a of articles.slice(0, opts.cap)) {
    const url = (a.url ?? '').trim();
    const title = cleanTitle(a.title ?? '');
    if (!url || !title) continue;
    const dedupeKey = `${META.slug}:${djb2hex(url)}`;
    if (opts.seen.has(dedupeKey)) continue; // cross-query overlap in this sync
    opts.seen.add(dedupeKey);
    const observedAt = parseSeendate(a.seendate, opts.fetchedAt);
    // artlist has no description field — summary is the source context line.
    const summary = [a.domain, a.sourcecountry, a.language]
      .filter((p): p is string => typeof p === 'string' && p.length > 0)
      .join(' · ')
      .slice(0, 300);
    signals.push({
      sourceSlug: META.slug,
      kind: opts.kind,
      title: title.slice(0, 200),
      summary: summary || undefined,
      severity: 'info',
      // non-geographic — DOC artlist carries no coordinates (header comment)
      observedAt,
      expiresAt: observedAt + opts.ttlMs,
      dedupeKey,
      confidence: 0.6, // aggregated/modeled tier (ARCHITECTURE §4 cites GDELT)
      provenance: JSON.stringify({ method: 'poll', fetchedAt: opts.fetchedAt, url: opts.queryUrl }),
      raw: JSON.stringify({ url, domain: a.domain, sourcecountry: a.sourcecountry }).slice(0, 2048),
    });
  }
  return signals;
}

export const sync = internalAction({
  args: {},
  handler: async (ctx) => {
    const fetchedAt = Date.now();
    const seen = new Set<string>();
    const signals: SignalInput[] = [];
    const errors: string[] = [];

    // ---- (a) VI news pulse ----
    try {
      const articles = await gdeltArticles(VI_URL, 'vi-artlist');
      signals.push(
        ...toSignals(articles, {
          kind: 'news',
          cap: VI_CAP,
          ttlMs: WEEK_MS,
          queryUrl: VI_URL,
          fetchedAt,
          seen,
        }),
      );
    } catch (e) {
      errors.push(String(e));
    }

    await sleep(RATE_SPACING_MS); // serialize: >=6s between the two queries

    // ---- (b) world conflict/disaster pulse ----
    try {
      const articles = await gdeltArticles(WORLD_URL, 'world-artlist');
      signals.push(
        ...toSignals(articles, {
          kind: 'world-event',
          cap: WORLD_CAP,
          ttlMs: TWO_DAYS_MS,
          queryUrl: WORLD_URL,
          fetchedAt,
          seen,
        }),
      );
    } catch (e) {
      errors.push(String(e));
    }

    try {
      await ctx.runMutation(internal.feeds.gdelt.ingest, { signals, errors });
    } catch (e) {
      await ctx.runMutation(internal.feeds.gdelt.fail, { error: String(e) });
    }
  },
});

export const ingest = internalMutation({
  args: { signals: v.array(v.any()), errors: v.array(v.string()) },
  handler: async (ctx, { signals, errors }) => {
    const { inserted, updated } = await upsertSignals(ctx, signals as SignalInput[]);
    // Health policy (header comment): one query failing is degradation we
    // tolerate (the other half still landed; GDELT 429s are weather, not
    // outage) — the source only goes unhealthy when BOTH queries failed.
    if (errors.length >= 2) {
      await reportFailure(ctx, META, errors.join(' | '));
    } else {
      await reportSuccess(ctx, META, signals.length);
    }
    return { inserted, updated };
  },
});

export const fail = internalMutation({
  args: { error: v.string() },
  handler: async (ctx, { error }) => {
    await reportFailure(ctx, META, error);
  },
});
