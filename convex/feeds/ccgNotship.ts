import { v } from 'convex/values';
import { internalAction, internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { fetchSource } from '../lib/fetchSource';
import { cellOf } from '../lib/geo';
import { upsertSignals, reportSuccess, reportFailure, type SourceMeta } from '../lib/ingest';

// ccg-notship — SOURCES.md: CCG NAVWARN (Notices to Shipping). The official
// NIS endpoint is server-rendered HTML only (JSON refused with 406, catalog
// gotcha) — parse the search page's gridViewBlock divs. NOTSHIPs were replaced
// by NAVWARNs; the slug keeps the catalog id. Signals kind 'marine-notice',
// severity info/watch, lat/lng parsed defensively from coordinates in the
// notice text (degrees + decimal minutes, e.g. "49 17.523N 122 53.492W").
// Display-only safety info — not to be used for navigation. Worst case 100
// signals/sync (spec cap; ~50 Pacific NAVWARNs in force at verify time, one
// ~1.2MB HTML page). Cadence: slow lane (3600s).
const META: SourceMeta = {
  slug: 'ccg-notship',
  name: 'CCG NAVWARN Notices',
  cluster: 'Seas (Marine)',
  cadenceSec: 3600,
  attribution: 'Canadian Coast Guard / Government of Canada',
};

const URL =
  'https://nis.ccg-gcc.gc.ca/public/rest/messages/en/search' +
  '?areas=250&status=PUBLISHED&sortBy=DATE&maxHits=500';

// Marine variant of the VI bbox (ARCHITECTURE §4 allows documented per-source
// boxes): area 250 spans the whole BC coast, so keep notices whose parsed
// position falls in VI-adjacent waters; coordinate-less notices are kept
// (they cannot be filtered and are usually coast-wide relevant).
const MARINE_BOX = { south: 48.0, west: -129.5, north: 51.5, east: -122.5 } as const;

const MAX_SIGNALS = 100;

// Severity (no upstream field — heuristic on the notice text, documented per
// ARCHITECTURE §4): closures/exclusions/firing/hazard notices = watch, the
// rest (aids to navigation outages, surveys, dredging…) = info.
function severityOf(text: string): 'info' | 'watch' {
  return /\b(closed|closure|prohibited|exclusion|firing|hazardous|restricted|do not approach)\b/i.test(
    text,
  )
    ? 'watch'
    : 'info';
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

// Mean position of every "DD MM.mmmN DDD MM.mmmW" pair in the text (degrees +
// decimal minutes, the format observed live). Returns undefined when no pair
// parses or the centroid is implausible for the Pacific coast.
function centroidOf(text: string): { lat: number; lng: number } | undefined {
  const pairs = text.matchAll(
    /(\d{2})[ -](\d{1,2}(?:\.\d+)?)\s*'?\s*N[,;]?\s+(\d{2,3})[ -](\d{1,2}(?:\.\d+)?)\s*'?\s*W/g,
  );
  let lat = 0;
  let lng = 0;
  let n = 0;
  for (const m of pairs) {
    lat += +m[1] + +m[2] / 60;
    lng -= +m[3] + +m[4] / 60;
    n++;
  }
  if (n === 0) return undefined;
  lat /= n;
  lng /= n;
  if (lat < 40 || lat > 62 || lng < -145 || lng > -110) return undefined;
  return { lat, lng };
}

// "2026-06-11 02:41 UTC To 2026-06-12 02:00 UTC" → [startMs, endMs?]
function parseDates(text: string): { start?: number; end?: number } {
  const stamps = [...text.matchAll(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2}) UTC/g)].map((m) =>
    Date.parse(`${m[1].replace(' ', 'T')}:00Z`),
  );
  const valid = stamps.filter((ms) => !Number.isNaN(ms));
  return { start: valid[0], end: valid[1] };
}

interface ParsedNotice {
  id: string;
  title: string;
  number?: string;
  description: string;
  start?: number;
  end?: number;
}

// Each result is a gridViewBlock div (stable GC WET markup): message link →
// id, gridViewTitle → title, a "… UTC To … UTC" line, a NW-P-NNNN-YY span,
// gridViewDescription → body text.
function parseBlocks(html: string): ParsedNotice[] {
  const notices: ParsedNotice[] = [];
  const blocks = html.split('class="gridViewBlock"').slice(1);
  for (const block of blocks) {
    const id = /\/public\/rest\/messages\/en\/message\/(\d+)/.exec(block)?.[1];
    if (!id) continue;
    const titleHtml = /class="[^"]*gridViewTitle[^"]*"\s*>([\s\S]*?)<\/div>/.exec(block)?.[1];
    const descHtml = /class="[^"]*gridViewDescription[^"]*"\s*>([\s\S]*?)<\/div>/.exec(block)?.[1];
    const number = /\b(NW-[A-Z]+-\d+-\d+)\b/.exec(block)?.[1];
    const { start, end } = parseDates(block);
    const title = stripTags(titleHtml ?? '');
    if (!title) continue;
    notices.push({ id, title, number, description: stripTags(descHtml ?? ''), start, end });
  }
  return notices;
}

export const sync = internalAction({
  args: {},
  handler: async (ctx) => {
    try {
      const res = await fetchSource(URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      const notices = parseBlocks(html);
      if (notices.length === 0 && !html.includes('gridView')) {
        throw new Error('unrecognized search page markup (0 blocks)');
      }
      const fetchedAt = Date.now();
      const signals = [];
      for (const n of notices) {
        const pos = centroidOf(n.description);
        if (pos && (pos.lat < MARINE_BOX.south || pos.lat > MARINE_BOX.north)) continue;
        if (pos && (pos.lng < MARINE_BOX.west || pos.lng > MARINE_BOX.east)) continue;
        const text = `${n.title} ${n.description}`;
        signals.push({
          sourceSlug: META.slug,
          kind: 'marine-notice',
          title: n.number ? `${n.number} — ${n.title}` : n.title,
          summary: n.description.slice(0, 300) || undefined,
          severity: severityOf(text),
          lat: pos?.lat,
          lng: pos?.lng,
          cell: pos ? cellOf(pos.lat, pos.lng) : undefined,
          observedAt: n.start ?? fetchedAt,
          // In-force notices are re-upserted each sync, sliding this forward;
          // cancelled ones drop out of the search and age out within 7 days.
          expiresAt: n.end ?? fetchedAt + 7 * 24 * 3600 * 1000,
          dedupeKey: `${META.slug}:${n.id}`, // NIS message ids are global+stable
          confidence: 1.0, // agency notice (CCG)
          provenance: JSON.stringify({
            method: 'poll',
            fetchedAt,
            upstreamId: n.id,
            url: `https://nis.ccg-gcc.gc.ca/public/rest/messages/en/message/${n.id}`,
          }),
          raw: JSON.stringify({ number: n.number, title: n.title }).slice(0, 2000),
        });
        if (signals.length >= MAX_SIGNALS) break;
      }
      await ctx.runMutation(internal.feeds.ccgNotship.ingest, { signals });
    } catch (e) {
      await ctx.runMutation(internal.feeds.ccgNotship.fail, { error: String(e) });
    }
  },
});

export const ingest = internalMutation({
  args: { signals: v.array(v.any()) },
  handler: async (ctx, { signals }) => {
    const { inserted, updated } = await upsertSignals(ctx, signals);
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
