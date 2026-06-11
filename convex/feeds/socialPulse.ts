import { v } from 'convex/values';
import { internalAction, internalMutation, internalQuery } from '../_generated/server';
import { internal } from '../_generated/api';
import { fetchSource } from '../lib/fetchSource';
import {
  upsertSignals,
  reportSuccess,
  reportFailure,
  type SourceMeta,
  type SignalInput,
} from '../lib/ingest';

// social-pulse — SOURCES.md: Pulse (News / Civic / Events), entries `reddit-vi`
// + `bluesky-search`. One module, ONE sourceSlug 'social-pulse'; the network
// lives in `raw`.
//
// AGGREGATE ONLY (BRIEF guardrail): this is ambient community pulse, never
// individual surveillance. Titles are post titles/text only — no usernames or
// handles anywhere in stored records; `raw` carries network + subreddit +
// score (Reddit) or network + engagement counts (Bluesky) only.
//
// Reddit (r/VancouverIsland, r/VictoriaBC, r/nanaimo): unauthenticated
// new.json is 403-blocked from non-residential IPs (re-verified 2026-06-11:
// HTTP 403 text/html block page) — the free OAuth script app is the only
// route per SOURCES.md. NEEDS-KEY: env vars REDDIT_CLIENT_ID +
// REDDIT_CLIENT_SECRET (script app at reddit.com/prefs/apps;
// grant_type=client_credentials — bogus-cred error shape verified live:
// HTTP 401 {"message":"Unauthorized","error":401}). App-only bearer tokens
// are cached in `apiTokens` under provider 'reddit' (ARCHITECTURE §5 rule 9,
// refresh at expiresAt − 60s); a 401 on a listing invalidates the cache so
// the next sync re-fetches. One listing request per subreddit per sync
// (3 + ≤1 token request ≈ well inside the 100 QPM free tier).
//
// Bluesky: public AppView searchPosts, keyless — re-verified 2026-06-11:
// HTTP 200, {posts:[{uri,author,record:{text,createdAt},likeCount,…}],cursor}.
// Single 'Vancouver Island' phrase search, sort=latest. Gotcha per SOURCES.md:
// unauthenticated access has been tightened before — any non-OK response is
// handled gracefully as that half's failure (no auth fallback built).
//
// Severity mapping: social chatter has no upstream severity scale — every
// record is ambient 'info'; escalation is the brain's job. Confidence 0.4
// (scraped/unofficial tier). kind 'news'. No lat/lng/cell (no geocoding at
// ingest); the subreddit set / search phrase IS the VI filter. dedupeKey
// 'social:<post fullname|at-uri>'. expiresAt = observedAt + 3d.
//
// Health policy (one slug = one health row): the healthy half always ingests,
// but any half failing marks the row unhealthy with an error string carrying
// the surviving half's count — so while the Reddit key is missing the row
// shows stale/down with 'REDDIT_CLIENT_ID … not configured' (expected state,
// PLAN.md keys queue) while Bluesky records still flow. Reddit tolerates one
// of three subreddits failing (majority policy, newsRss precedent). Empty
// results in fair weather = success (count 0).
//
// Worst case 3×20 + 20 = 80 records/sync. Cadence: medium lane (900s).
const META: SourceMeta = {
  slug: 'social-pulse',
  name: 'Social Pulse (Reddit + Bluesky)',
  cluster: 'Pulse (News / Civic / Events)',
  cadenceSec: 900,
  attribution: 'Reddit (r/VancouverIsland · r/VictoriaBC · r/nanaimo) · Bluesky public search',
  licenseNote:
    'Aggregate pulse only — titles/scores with link back upstream; no per-user tracking, no full-text republication',
};

// SOURCES.md auth note prescribes the platform:app:version UA form for Reddit.
const REDDIT_UA = 'server:blindspot-osint:v0.1 (personal OSINT console; samuel.putra101@gmail.com)';
const SUBREDDITS = ['VancouverIsland', 'VictoriaBC', 'nanaimo'];
const TOKEN_URL = 'https://www.reddit.com/api/v1/access_token';
const BSKY_URL =
  'https://api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=%22Vancouver%20Island%22&limit=20&sort=latest';
const CAP = 20; // per subreddit and for the Bluesky search
const TTL_MS = 3 * 24 * 60 * 60 * 1000; // expiresAt = observedAt + 3d

const clean = (s: string): string => s.replace(/\s+/g, ' ').trim();

interface RedditChild {
  data?: {
    id?: string;
    name?: string; // fullname 't3_…' — the stable id behind dedupeKey
    title?: string;
    created_utc?: number;
    permalink?: string;
    subreddit?: string;
    score?: number;
  };
}

interface RedditListing {
  data?: { children?: RedditChild[] };
}

interface BskyPost {
  uri?: string;
  likeCount?: number;
  repostCount?: number;
  replyCount?: number;
  record?: { text?: string; createdAt?: string };
}

// fetchSource is GET-only, so the token POST uses plain fetch with its own
// 20s abort. expires_in is seconds (app-only tokens are typically 24h).
async function fetchRedditToken(
  clientId: string,
  clientSecret: string,
): Promise<{ token: string; expiresAt: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': REDDIT_UA,
      },
      body: 'grant_type=client_credentials',
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`token HTTP ${res.status}`);
    const data = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) throw new Error('token response missing access_token');
    return {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    };
  } finally {
    clearTimeout(timer);
  }
}

export const sync = internalAction({
  args: {},
  handler: async (ctx) => {
    const fetchedAt = Date.now();
    const signals: SignalInput[] = [];

    // ---- Reddit half (NEEDS-KEY) ----
    let redditCount: number | undefined;
    let redditError: string | undefined;
    const clientId = process.env.REDDIT_CLIENT_ID;
    const clientSecret = process.env.REDDIT_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      redditError = 'REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET not configured (see PLAN.md keys queue)';
    } else {
      try {
        let token = await ctx.runQuery(internal.feeds.socialPulse.getToken, {});
        if (token === null) {
          const fresh = await fetchRedditToken(clientId, clientSecret);
          await ctx.runMutation(internal.feeds.socialPulse.saveToken, fresh);
          token = fresh.token;
        }
        const subErrors: string[] = [];
        let sawUnauthorized = false;
        redditCount = 0;
        for (const sub of SUBREDDITS) {
          try {
            const res = await fetchSource(
              `https://oauth.reddit.com/r/${sub}/new?limit=${CAP}&raw_json=1`,
              { headers: { Authorization: `Bearer ${token}`, 'User-Agent': REDDIT_UA } },
            );
            if (res.status === 401) {
              sawUnauthorized = true;
              throw new Error('HTTP 401 (token rejected)');
            }
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const listing = (await res.json()) as RedditListing;
            for (const child of (listing.data?.children ?? []).slice(0, CAP)) {
              const d = child.data;
              const title = clean(d?.title ?? '');
              const fullname = d?.name ?? (d?.id ? `t3_${d.id}` : '');
              if (!title || !fullname) continue;
              const observedAt =
                typeof d?.created_utc === 'number' ? d.created_utc * 1000 : fetchedAt;
              signals.push({
                sourceSlug: META.slug,
                kind: 'news',
                title,
                summary: `r/${d?.subreddit ?? sub} · score ${d?.score ?? 0}`,
                severity: 'info',
                observedAt,
                expiresAt: observedAt + TTL_MS,
                dedupeKey: `social:${fullname}`,
                confidence: 0.4,
                provenance: JSON.stringify({
                  method: 'poll',
                  fetchedAt,
                  upstreamId: fullname,
                  url: d?.permalink ? `https://www.reddit.com${d.permalink}` : undefined,
                }),
                raw: JSON.stringify({
                  network: 'reddit',
                  subreddit: d?.subreddit ?? sub,
                  score: d?.score ?? 0,
                }),
              });
              redditCount++;
            }
          } catch (e) {
            subErrors.push(`r/${sub}: ${String(e)}`);
          }
        }
        // Stale cached token (rotated secret etc.) — invalidate so the next
        // sync re-fetches instead of 401-ing until natural expiry.
        if (sawUnauthorized) {
          await ctx.runMutation(internal.feeds.socialPulse.saveToken, { token: '', expiresAt: 0 });
        }
        if (subErrors.length * 2 > SUBREDDITS.length) {
          redditError = subErrors.join(' | ');
          redditCount = undefined;
        }
      } catch (e) {
        redditError = String(e);
        redditCount = undefined;
      }
    }

    // ---- Bluesky half (keyless, graceful on tightening) ----
    let blueskyCount: number | undefined;
    let blueskyError: string | undefined;
    try {
      const res = await fetchSource(BSKY_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { posts?: BskyPost[] };
      blueskyCount = 0;
      for (const post of (data.posts ?? []).slice(0, CAP)) {
        const text = clean(post.record?.text ?? '');
        const uri = post.uri ?? '';
        if (!text || !uri) continue;
        const createdMs = Date.parse(post.record?.createdAt ?? '');
        const observedAt = Number.isNaN(createdMs) ? fetchedAt : createdMs;
        signals.push({
          sourceSlug: META.slug,
          kind: 'news',
          title: text.length > 200 ? `${text.slice(0, 200)}…` : text,
          summary: `Bluesky · ${post.likeCount ?? 0} likes · ${post.repostCount ?? 0} reposts`,
          severity: 'info',
          observedAt,
          expiresAt: observedAt + TTL_MS,
          dedupeKey: `social:${uri}`,
          confidence: 0.4,
          provenance: JSON.stringify({ method: 'poll', fetchedAt, upstreamId: uri, url: BSKY_URL }),
          raw: JSON.stringify({
            network: 'bluesky',
            likes: post.likeCount ?? 0,
            reposts: post.repostCount ?? 0,
            replies: post.replyCount ?? 0,
          }),
        });
        blueskyCount++;
      }
    } catch (e) {
      blueskyError = String(e);
      blueskyCount = undefined;
    }

    try {
      await ctx.runMutation(internal.feeds.socialPulse.ingest, {
        signals,
        redditCount,
        redditError,
        blueskyCount,
        blueskyError,
      });
    } catch (e) {
      await ctx.runMutation(internal.feeds.socialPulse.fail, { error: String(e) });
    }
  },
});

// Cached app-only bearer token, ARCHITECTURE §5 rule 9: fresh while
// expiresAt − 60s is in the future, null otherwise.
export const getToken = internalQuery({
  args: {},
  handler: async (ctx): Promise<string | null> => {
    const row = await ctx.db
      .query('apiTokens')
      .withIndex('by_provider', (q) => q.eq('provider', 'reddit'))
      .unique();
    if (!row || row.expiresAt - 60_000 <= Date.now() || !row.token) return null;
    return row.token;
  },
});

export const saveToken = internalMutation({
  args: { token: v.string(), expiresAt: v.number() },
  handler: async (ctx, { token, expiresAt }) => {
    const row = await ctx.db
      .query('apiTokens')
      .withIndex('by_provider', (q) => q.eq('provider', 'reddit'))
      .unique();
    if (row) {
      await ctx.db.patch(row._id, { token, expiresAt });
    } else {
      await ctx.db.insert('apiTokens', { provider: 'reddit', token, expiresAt });
    }
  },
});

export const ingest = internalMutation({
  args: {
    signals: v.array(v.any()),
    redditCount: v.optional(v.number()),
    redditError: v.optional(v.string()),
    blueskyCount: v.optional(v.number()),
    blueskyError: v.optional(v.string()),
  },
  handler: async (ctx, { signals, redditCount, redditError, blueskyCount, blueskyError }) => {
    const { inserted, updated } = await upsertSignals(ctx, signals as SignalInput[]);
    // One health row for two networks: any half failing marks the row
    // unhealthy, but the surviving half's records are already upserted and
    // its count is carried in the error string (header comment, health policy).
    if (redditError !== undefined || blueskyError !== undefined) {
      const parts = [
        redditError !== undefined ? `Reddit: ${redditError}` : `Reddit OK (${redditCount ?? 0})`,
        blueskyError !== undefined ? `Bluesky: ${blueskyError}` : `Bluesky OK (${blueskyCount ?? 0})`,
      ];
      await reportFailure(ctx, META, parts.join(' — '));
    } else {
      await reportSuccess(ctx, META, (redditCount ?? 0) + (blueskyCount ?? 0));
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
