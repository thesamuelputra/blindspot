import { v } from 'convex/values';
import { internalAction, internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { fetchSource } from '../lib/fetchSource';
import { parseXml, asArray } from '../lib/xml';
import {
  upsertSignals,
  reportSuccess,
  reportFailure,
  type SourceMeta,
  type SignalInput,
} from '../lib/ingest';

// local-news-rss + google-news-rss — SOURCES.md: Pulse (News / Civic / Events).
// One sweep over the 13 verified outlet RSS feeds (Times Colonist, CHEK,
// CTV VI Arc XP, Capital Daily, 5× Black Press weeklies, CBC BC, Victoria
// Buzz, NanaimoNewsNOW, BC Gov News) plus the Google News VI search feed.
// Sequential fetches, isolated try/catch per outlet — one dead outlet never
// kills the sweep. Two health rows: outlet set under `local-news-rss`
// (failure only when >half the outlets fail), Google News under
// `google-news-rss` (own try/catch).
//
// Severity mapping: news headlines carry no upstream severity scale — every
// record is ambient `info`; escalation is the brain's job (fusion rules), not
// ingestion's. Confidence 0.4 (scraped/unofficial tier — headlines, not
// agency telemetry). No lat/lng/cell: items are not geocoded (BRIEF rule —
// no geocoder at ingest). dedupeKey `news:<djb2 hex of link>` so the same
// story re-served across polls (or syndicated with an identical link)
// upserts; Google items dedupe against outlet items only when links match.
// expiresAt = observedAt + 7d.
//
// License notes (SOURCES.md): render headline+link+attribution only, never
// full text. Google News RSS is personal/non-commercial use only — keep it a
// gap-filler. CBC feed is 'FOR PERSONAL USE ONLY'.
//
// Worst case 14 feeds × 40 items = 560 records/sync (typically far fewer;
// most feeds serve 10-20 items). Cadence: medium lane (900s).
const META_LOCAL: SourceMeta = {
  slug: 'local-news-rss',
  name: 'VI Local News (RSS outlets)',
  cluster: 'Pulse (News / Civic / Events)',
  cadenceSec: 900,
  attribution:
    'Times Colonist · CHEK News · CTV News Vancouver Island · Capital Daily · Black Press Media · CBC/Radio-Canada · Victoria Buzz · NanaimoNewsNOW · BC Gov News',
  licenseNote: 'Headline + link + per-outlet attribution only; do not republish full text',
};

const META_GOOGLE: SourceMeta = {
  slug: 'google-news-rss',
  name: 'Google News RSS (Vancouver Island)',
  cluster: 'Pulse (News / Civic / Events)',
  cadenceSec: 900,
  attribution: 'Google News + original publisher (source appended to item titles)',
  licenseNote: 'Personal, non-commercial feed-reader use only per in-feed copyright',
};

interface Outlet {
  id: string;
  name: string;
  url: string;
  weight: number; // editorial weight for downstream analysis (1.0 = full trust)
  headers?: Record<string, string>; // per-outlet header overrides (CBC UA gate)
  viKeywordFilter?: boolean; // BC-wide firehoses: keep VI-relevant items only
}

// CBC's edge serves an empty channel skeleton (HTTP 200, no items) to
// non-browser UAs — and from some networks resets the HTTP/2 stream on the
// BlindSpot UA outright — so it gets a browser UA override. An item-less 200
// still parses as zero items and counts as success.
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// Exact verified URLs from SOURCES.md (re-verified live at build time).
// Gotchas baked in: Times Colonist /feed 403s (use /rss); Capital Daily only
// /news/rss.xml works; CTV VI is the undocumented Arc XP section feed.
const OUTLETS: Outlet[] = [
  { id: 'times-colonist', name: 'Times Colonist', url: 'https://www.timescolonist.com/rss', weight: 1.0 },
  { id: 'chek-news', name: 'CHEK News', url: 'https://cheknews.ca/feed/', weight: 1.0 },
  {
    id: 'ctv-vi',
    name: 'CTV News Vancouver Island',
    url: 'https://www.ctvnews.ca/arc/outboundfeeds/rss/category/vancouver/vancouver-island/?outputType=xml',
    weight: 1.0,
  },
  { id: 'capital-daily', name: 'Capital Daily', url: 'https://www.capitaldaily.ca/news/rss.xml', weight: 0.9 },
  { id: 'vic-news', name: 'Victoria News', url: 'https://vicnews.com/feed/', weight: 0.8 },
  { id: 'saanich-news', name: 'Saanich News', url: 'https://saanichnews.com/feed/', weight: 0.8 },
  { id: 'oak-bay-news', name: 'Oak Bay News', url: 'https://oakbaynews.com/feed/', weight: 0.8 },
  { id: 'nanaimo-bulletin', name: 'Nanaimo News Bulletin', url: 'https://nanaimobulletin.com/feed/', weight: 0.8 },
  {
    id: 'comox-valley-record',
    name: 'Comox Valley Record',
    url: 'https://comoxvalleyrecord.com/feed/',
    weight: 0.8,
  },
  {
    id: 'cbc-bc',
    name: 'CBC British Columbia',
    url: 'https://www.cbc.ca/webfeed/rss/rss-canada-britishcolumbia',
    weight: 1.0,
    headers: { 'User-Agent': BROWSER_UA },
    viKeywordFilter: true, // BC-wide feed — keyword-filter per SOURCES.md
  },
  { id: 'victoria-buzz', name: 'Victoria Buzz', url: 'https://victoriabuzz.com/feed/', weight: 0.6 },
  { id: 'nanaimo-news-now', name: 'NanaimoNewsNOW', url: 'https://nanaimonewsnow.com/feed/', weight: 0.9 },
  {
    id: 'bc-gov-news',
    name: 'BC Gov News',
    url: 'https://news.gov.bc.ca/feed',
    weight: 1.0,
    viKeywordFilter: true, // province-wide firehose — keyword-filter per SOURCES.md
  },
];

const GOOGLE_URL =
  'https://news.google.com/rss/search?q=%22Vancouver+Island%22&hl=en-CA&gl=CA&ceid=CA:en';

const MAX_ITEMS_PER_OUTLET = 40;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Server-side VI relevance filter for the two BC-wide firehoses (CBC BC,
// BC Gov News) — the news analog of the VI bbox filter. Matched against
// title + description.
const VI_KEYWORDS =
  /vancouver island|victoria|saanich|esquimalt|oak bay|view royal|langford|colwood|metchosin|sooke|sidney|nanaimo|lantzville|ladysmith|duncan|cowichan|chemainus|parksville|qualicum|port alberni|tofino|ucluelet|comox|courtenay|cumberland|campbell river|port hardy|port mcneill|port renfrew|gold river|tahsis|zeballos|sayward|alert bay|salt ?spring|gulf islands|gabriola|quadra island|cortes island|denman island|hornby island|malahat|west ?shore|island health|bc ferries|salish sea|juan de fuca|strait of georgia/i;

// djb2 over the item link, rendered as uint32 hex — the stable content hash
// behind dedupeKey 'news:<hash>' (RSS links are the only stable cross-poll id;
// guids vary in form per generator).
function djb2hex(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

// fast-xml-parser leaves text nodes as string|number, and attribute-bearing
// nodes as { '#text': ... } — flatten either to a plain string.
function textOf(node: unknown): string {
  if (node === undefined || node === null) return '';
  if (typeof node === 'object') {
    const t = (node as Record<string, unknown>)['#text'];
    return t === undefined || t === null ? '' : String(t);
  }
  return String(node);
}

// Minimal entity decode (the shared parser leaves numeric/named entities
// in place) + tag strip + whitespace collapse. Descriptions are HTML in the
// WordPress and Google feeds.
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

interface RssItem {
  title?: unknown;
  link?: unknown;
  guid?: unknown;
  pubDate?: unknown;
  description?: unknown;
}

function parseItems(xml: string): RssItem[] {
  // BC Gov News serves a leading BOM — strip before parsing.
  const doc = parseXml(xml.replace(/^\uFEFF/, '')) as {
    rss?: { channel?: { item?: RssItem | RssItem[] } };
  };
  return asArray<RssItem>(doc?.rss?.channel?.item);
}

function toSignals(
  items: RssItem[],
  opts: {
    sourceSlug: string;
    outletId: string;
    feedUrl: string;
    fetchedAt: number;
    viFilter: boolean;
  },
): SignalInput[] {
  const signals: SignalInput[] = [];
  for (const it of items.slice(0, MAX_ITEMS_PER_OUTLET)) {
    const title = stripHtml(textOf(it.title));
    const link = textOf(it.link).trim();
    if (!title || !link) continue;
    const summary = stripHtml(textOf(it.description)).slice(0, 300);
    if (opts.viFilter && !VI_KEYWORDS.test(`${title} ${summary}`)) continue;
    const pubMs = Date.parse(textOf(it.pubDate));
    const observedAt = Number.isNaN(pubMs) ? opts.fetchedAt : pubMs;
    signals.push({
      sourceSlug: opts.sourceSlug,
      kind: 'news',
      title,
      summary: summary || undefined,
      severity: 'info',
      observedAt,
      expiresAt: observedAt + WEEK_MS,
      dedupeKey: `news:${djb2hex(link)}`,
      confidence: 0.4,
      provenance: JSON.stringify({ method: 'poll', fetchedAt: opts.fetchedAt, url: opts.feedUrl }),
      raw: JSON.stringify({ link, outlet: opts.outletId }).slice(0, 2048),
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

    // ---- outlet sweep (local-news-rss) — sequential, isolated failures ----
    const outletErrors: string[] = [];
    let outletCount = 0;
    for (const outlet of OUTLETS) {
      try {
        const res = await fetchSource(outlet.url, outlet.headers ? { headers: outlet.headers } : {});
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const items = parseItems(await res.text());
        for (const s of toSignals(items, {
          sourceSlug: META_LOCAL.slug,
          outletId: outlet.id,
          feedUrl: outlet.url,
          fetchedAt,
          viFilter: outlet.viKeywordFilter === true,
        })) {
          if (seen.has(s.dedupeKey)) continue; // cross-outlet syndication dedupe
          seen.add(s.dedupeKey);
          signals.push(s);
          outletCount++;
        }
      } catch (e) {
        outletErrors.push(`${outlet.id}: ${String(e)}`);
      }
    }

    // ---- Google News gap-filler (google-news-rss) — own health row ----
    let googleCount: number | undefined;
    let googleError: string | undefined;
    try {
      const res = await fetchSource(GOOGLE_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const items = parseItems(await res.text());
      googleCount = 0;
      for (const s of toSignals(items, {
        sourceSlug: META_GOOGLE.slug,
        outletId: 'google-news',
        feedUrl: GOOGLE_URL,
        fetchedAt,
        viFilter: false, // the query itself is the VI filter
      })) {
        if (seen.has(s.dedupeKey)) continue; // outlet items win on link-hash ties
        seen.add(s.dedupeKey);
        signals.push(s);
        googleCount++;
      }
    } catch (e) {
      googleError = String(e);
    }

    try {
      await ctx.runMutation(internal.feeds.newsRss.ingest, {
        signals,
        outletCount,
        outletErrors,
        outletTotal: OUTLETS.length,
        googleCount,
        googleError,
      });
    } catch (e) {
      await ctx.runMutation(internal.feeds.newsRss.fail, { error: String(e) });
    }
  },
});

export const ingest = internalMutation({
  args: {
    signals: v.array(v.any()),
    outletCount: v.number(),
    outletErrors: v.array(v.string()),
    outletTotal: v.number(),
    googleCount: v.optional(v.number()),
    googleError: v.optional(v.string()),
  },
  handler: async (ctx, { signals, outletCount, outletErrors, outletTotal, googleCount, googleError }) => {
    const { inserted, updated } = await upsertSignals(ctx, signals as SignalInput[]);
    // Health policy per spec: individual outlet failures are tolerated (the
    // sweep degrades gracefully); the outlet set only goes unhealthy when
    // more than half the outlets failed this sync.
    if (outletErrors.length * 2 > outletTotal) {
      await reportFailure(
        ctx,
        META_LOCAL,
        `${outletErrors.length}/${outletTotal} outlets failed — ${outletErrors.join(' | ')}`,
      );
    } else {
      await reportSuccess(ctx, META_LOCAL, outletCount);
    }
    if (googleError !== undefined) {
      await reportFailure(ctx, META_GOOGLE, googleError);
    } else {
      await reportSuccess(ctx, META_GOOGLE, googleCount ?? 0);
    }
    return { inserted, updated };
  },
});

export const fail = internalMutation({
  args: { error: v.string() },
  handler: async (ctx, { error }) => {
    await reportFailure(ctx, META_LOCAL, error);
    await reportFailure(ctx, META_GOOGLE, error);
  },
});
