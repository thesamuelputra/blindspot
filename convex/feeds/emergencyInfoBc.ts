import { v } from 'convex/values';
import { internalAction, internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { fetchSource } from '../lib/fetchSource';
import {
  upsertSignals,
  reportSuccess,
  reportFailure,
  type SignalInput,
  type SourceMeta,
} from '../lib/ingest';

// emergencyinfobc — SOURCES.md: Pulse (News / Civic / Events). The advertised
// RSS (/feed/) is STALE (newest item March 2024) — the live data lives in a
// WordPress custom post type at /wp-json/wp/v2/event (308 events, current
// June-2026 evacuation alerts/rescinds, with ACF status active/expired/referred).
// We poll the newest-modified page only.
//
// signals kind 'civic', severity 'watch' (these are emergency-adjacent: evac
// orders/alerts, floods, landslides, shelter-in-place). VI filtering: the
// region taxonomy is unused (only junk terms), so we keyword-match an island
// place-name list against title + excerpt (simple case-insensitive includes).
// Most events are mainland BC (Peace River, Cariboo, Okanagan) and are dropped;
// empty result in fair weather = success (count 0). dedupe by a stable hash of
// the event link, cap 30 (one upstream page). confidence 1.0 (provincial EMO,
// agency tier). No lat/lng (events are area-level, not a single point — no
// geocoder at ingest). observedAt = modified_gmt (when the event last changed);
// expiresAt = observedAt + 7d.
//
// License: B.C. Crown copyright; public-safety info intended for distribution;
// cite EmergencyInfoBC. CORS absent — server-side only. Cadence: medium (5 min
// during flood/fire season) — 600s.
const META: SourceMeta = {
  slug: 'emergencyinfobc',
  name: 'EmergencyInfoBC active events',
  cluster: 'Pulse (News / Civic / Events)',
  cadenceSec: 600,
  attribution: 'EmergencyInfoBC (Province of British Columbia)',
  licenseNote: 'B.C. Crown copyright; public-safety information intended for distribution',
};

const PER_PAGE = 30;
const URL = `https://www.emergencyinfobc.gov.bc.ca/wp-json/wp/v2/event?per_page=${PER_PAGE}&orderby=modified&order=desc`;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Vancouver Island place / regional-district names — simple includes match
// (SOURCES.md: geographic filtering must be keyword matching on title/content;
// the region taxonomy is unusable). Lower-cased; matched against title+excerpt.
// Kept tight to island places to avoid mainland false positives; 'vancouver
// island' itself is the broad catch.
const VI_KEYWORDS = [
  'vancouver island',
  'victoria',
  'saanich',
  'esquimalt',
  'oak bay',
  'view royal',
  'langford',
  'colwood',
  'metchosin',
  'sooke',
  'sidney',
  'nanaimo',
  'lantzville',
  'ladysmith',
  'duncan',
  'cowichan',
  'chemainus',
  'parksville',
  'qualicum',
  'port alberni',
  'tofino',
  'ucluelet',
  'comox',
  'courtenay',
  'cumberland',
  'campbell river',
  'port hardy',
  'port mcneill',
  'port renfrew',
  'gold river',
  'tahsis',
  'zeballos',
  'sayward',
  'alert bay',
  'salt spring',
  'saltspring',
  'gulf islands',
  'gabriola',
  'quadra island',
  'cortes island',
  'denman island',
  'hornby island',
  'malahat',
  'capital regional district',
  'cowichan valley regional district',
  'regional district of nanaimo',
  'comox valley regional district',
  'strathcona regional district',
  'mount waddington',
  'alberni-clayoquot',
] as const;

interface WpEvent {
  id: number;
  link: string;
  modified_gmt?: string; // 'YYYY-MM-DDTHH:MM:SS' (UTC, no zone)
  date_gmt?: string;
  title?: { rendered?: string };
  excerpt?: { rendered?: string };
  acf?: { status?: { value?: string } };
}

// Minimal HTML → text for titles/excerpts.
function stripHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&(?:apos|#39);/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// WP _gmt timestamps are UTC without an offset — append Z before parsing.
function parseGmt(s: string | undefined): number {
  if (!s) return NaN;
  const iso = s.trim();
  return Date.parse(iso.endsWith('Z') ? iso : iso + 'Z');
}

// djb2 over the event link → uint32 hex; the stable cross-poll identity.
function djb2hex(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

function toSignal(e: WpEvent, fetchedAt: number): SignalInput | null {
  const title = stripHtml(e.title?.rendered ?? '');
  const link = (e.link ?? '').trim();
  if (!title || !link) return null;
  const summary = stripHtml(e.excerpt?.rendered ?? '').slice(0, 300);
  const haystack = `${title} ${summary}`.toLowerCase();
  if (!VI_KEYWORDS.some((kw) => haystack.includes(kw))) return null;

  const modifiedMs = parseGmt(e.modified_gmt) || parseGmt(e.date_gmt);
  const observedAt = Number.isFinite(modifiedMs) ? modifiedMs : fetchedAt;
  const status = e.acf?.status?.value;

  return {
    sourceSlug: META.slug,
    kind: 'civic',
    title: title.slice(0, 200),
    summary: summary || undefined,
    severity: 'watch',
    // no lat/lng — events are area-level, not a single VI point
    observedAt,
    expiresAt: observedAt + WEEK_MS,
    dedupeKey: `${META.slug}:${djb2hex(link)}`,
    confidence: 1.0,
    provenance: JSON.stringify({
      method: 'poll',
      fetchedAt,
      upstreamId: String(e.id),
      url: link,
    }),
    raw: JSON.stringify({ link, status }).slice(0, 2048),
  };
}

export const sync = internalAction({
  args: {},
  handler: async (ctx) => {
    try {
      const res = await fetchSource(URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const events = (await res.json()) as WpEvent[];
      if (!Array.isArray(events)) throw new Error('unexpected response (not an array)');
      const fetchedAt = Date.now();
      const seen = new Set<string>();
      const signals: SignalInput[] = [];
      for (const e of events.slice(0, PER_PAGE)) {
        const s = toSignal(e, fetchedAt);
        if (!s || seen.has(s.dedupeKey)) continue;
        seen.add(s.dedupeKey);
        signals.push(s);
      }
      await ctx.runMutation(internal.feeds.emergencyInfoBc.ingest, { signals });
    } catch (e) {
      await ctx.runMutation(internal.feeds.emergencyInfoBc.fail, { error: String(e) });
    }
  },
});

export const ingest = internalMutation({
  args: { signals: v.array(v.any()) },
  handler: async (ctx, { signals }) => {
    const { inserted, updated } = await upsertSignals(ctx, signals as SignalInput[]);
    await reportSuccess(ctx, META, signals.length);
    return { inserted, updated };
  },
});

export const fail = internalMutation({
  args: { error: v.string() },
  handler: async (ctx, { error }) => {
    await reportFailure(ctx, META, error);
  },
});
