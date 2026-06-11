import { v } from 'convex/values';
import { internalAction, internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { fetchSource } from '../lib/fetchSource';
import { upsertSignals, reportSuccess, reportFailure, type SourceMeta, type SignalInput } from '../lib/ingest';

// who-outbreaks — SOURCES.md entry `who-promed`: World Mode (Global). WHO
// Disease Outbreak News via the verified DON JSON API (the old
// /feeds/entity/csr/don rss.xml is dead, and ProMED-mail is excluded — its
// RSS was permanently closed in 2023). Re-verified live 2026-06-11: 200,
// {value:[{Id, Title, UrlName, ItemDefaultUrl, PublicationDateAndTime,
// Summary, Overview(HTML), DonId, ...}]}.
//
// WORLD page signals (Phase 5) — kind 'world-event', severity 'watch' for
// every item (per spec; DON publishes only noteworthy outbreaks and carries
// no upstream severity scale). The country is already in the WHO title
// ('Ebola disease ..., Democratic Republic of the Congo & Uganda'). No
// lat/lng/cell: country/region-level prose, no geocoder at ingest. The VI
// bbox filter is deliberately skipped — world-event signals are exempt by
// definition (ARCHITECTURE §4). dedupeKey 'who-outbreaks:<djb2 hex of
// ItemDefaultUrl>' (dedupe by link hash per spec; the link is the stable
// cross-poll id). Summary/Overview carry HTML — tags stripped before
// storing. expiresAt = observedAt + 7d. Cap 20 ($top=20 upstream + a
// defensive slice). Cadence: slow lane (21600s; DON posts a few items/week).
const META: SourceMeta = {
  slug: 'who-outbreaks',
  name: 'WHO Disease Outbreak News',
  cluster: 'World Mode (Global)',
  cadenceSec: 21600,
  attribution: 'World Health Organization, Disease Outbreak News',
  licenseNote: 'CC BY-NC-SA 3.0 IGO: attribute WHO, non-commercial use only',
};

const URL =
  'https://www.who.int/api/news/diseaseoutbreaknews?sf_provider=dynamicProvider372&sf_culture=en' +
  '&%24orderby=PublicationDateAndTime%20desc&%24top=20&%24format=json';
const ITEM_BASE = 'https://www.who.int/emergencies/disease-outbreak-news/item';
const WEEK_MS = 7 * 24 * 3600 * 1000;
const CAP = 20;

interface DonItem {
  Id?: string;
  Title?: string;
  UrlName?: string; // '2026-DON606'
  ItemDefaultUrl?: string; // '/2026-DON606'
  PublicationDateAndTime?: string; // ISO with Z
  PublicationDate?: string;
  DateCreated?: string;
  LastModified?: string;
  Summary?: string;
  Overview?: string; // HTML
  DonId?: string;
}

// djb2 over the item link, rendered as uint32 hex (same scheme as news-rss).
function djb2hex(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

// Summary/Overview embed HTML (links, &nbsp;) — strip to plain text for the
// 300-char summary; full sanitization is the renderer's job.
function stripHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#?\w+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const sync = internalAction({
  args: {},
  handler: async (ctx) => {
    try {
      const res = await fetchSource(URL, { timeoutMs: 30_000 });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { value?: DonItem[] };
      const fetchedAt = Date.now();

      const signals: SignalInput[] = [];
      for (const item of (data.value ?? []).slice(0, CAP)) {
        const link = item.ItemDefaultUrl ?? (item.UrlName ? `/${item.UrlName}` : undefined);
        if (!link || !item.Title) continue;
        const observedAt =
          Date.parse(
            item.PublicationDateAndTime ?? item.PublicationDate ?? item.DateCreated ?? '',
          ) || fetchedAt;
        const summary = stripHtml(item.Summary || item.Overview || '').slice(0, 300);
        // World source: VI bbox filter deliberately skipped (world-event kind).
        signals.push({
          sourceSlug: META.slug,
          kind: 'world-event',
          title: item.Title.slice(0, 200),
          summary: summary || undefined,
          severity: 'watch',
          // country-level prose, no coordinates — non-geographic signal
          observedAt,
          expiresAt: observedAt + WEEK_MS,
          dedupeKey: `who-outbreaks:${djb2hex(link)}`,
          confidence: 1.0, // agency feed (WHO)
          provenance: JSON.stringify({
            method: 'poll',
            fetchedAt,
            upstreamId: item.DonId ?? item.UrlName ?? link,
            url: `${ITEM_BASE}${link}`,
          }),
          raw: JSON.stringify({
            DonId: item.DonId,
            UrlName: item.UrlName,
            PublicationDateAndTime: item.PublicationDateAndTime,
            LastModified: item.LastModified,
          }).slice(0, 2000),
        });
      }

      await ctx.runMutation(internal.feeds.whoOutbreaks.ingest, { signals });
    } catch (e) {
      await ctx.runMutation(internal.feeds.whoOutbreaks.fail, { error: String(e) });
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
