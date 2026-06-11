import { v } from 'convex/values';
import { internalAction, internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { fetchSource } from '../lib/fetchSource';
import { upsertSignals, reportSuccess, reportFailure, type SourceMeta, type SignalInput } from '../lib/ingest';

// gac-travel — SOURCES.md: World Mode (Global). Global Affairs Canada travel
// advisories, official open-data JSON index (keyless, OGL-Canada).
// Re-verified live 2026-06-11: {metadata:{generated:{timestamp}}, data:
// {<ISO2>:{country-eng, advisory-state(0-3), date-published:{timestamp},
// eng:{name, url-slug, advisory-text, recent-updates}, ...}}}, 230 countries.
//
// WORLD page signals (Phase 5) — kind 'world-event'. Only the avoid-travel
// tiers are ingested (spec: "levels 3-4" on GAC's public 1-4 scale). The
// JSON encodes that scale as advisory-state 0..3 (verified: state 3 =
// 'Avoid all travel'), so public level 3 = advisory-state 2 ('Avoid
// non-essential travel') → watch, public level 4 = advisory-state 3
// ('Avoid all travel') → warning. States 0-1 are skipped.
//
// Country-level records — no lat/lng/cell (no geocoder at ingest), and the
// VI bbox filter is deliberately skipped: world-event signals are exempt by
// definition (ARCHITECTURE §4). dedupeKey 'gac:<ISO2>' (per spec) — one
// living signal per country, re-upserted while the advisory stands.
// observedAt = date-published (advisories can stand for months);
// expiresAt = poll time + 7d, refreshed every sync so a country drops out a
// week after it leaves the feed or falls below the avoid-travel tiers.
// Cap 60 (39 qualifying countries at verification), highest state first.
// Cadence: daily (86400s; honor the upstream Last-Modified hint by polling
// gently rather than conditionally — the file is ~200 KB).
const META: SourceMeta = {
  slug: 'gac-travel',
  name: 'GAC travel advisories (avoid travel)',
  cluster: 'World Mode (Global)',
  cadenceSec: 86400,
  attribution: 'Global Affairs Canada travel advisories',
  licenseNote: 'Contains information licensed under the Open Government Licence - Canada',
};

const URL = 'https://data.international.gc.ca/travel-voyage/index-alpha-eng.json';
const WEEK_MS = 7 * 24 * 3600 * 1000;
const CAP = 60;

interface GacEntry {
  'country-eng'?: string;
  'advisory-state'?: number; // 0 normal · 1 high caution · 2 avoid non-essential · 3 avoid all
  'date-published'?: { timestamp?: number }; // unix seconds
  'has-regional-advisory'?: number;
  'recent-updates-type'?: string;
  eng?: {
    name?: string;
    'url-slug'?: string;
    'advisory-text'?: string;
    'recent-updates'?: string;
  };
}

export const sync = internalAction({
  args: {},
  handler: async (ctx) => {
    try {
      const res = await fetchSource(URL, { timeoutMs: 30_000 });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { data?: Record<string, GacEntry> };
      const fetchedAt = Date.now();

      const signals: SignalInput[] = [];
      for (const [iso, entry] of Object.entries(body.data ?? {})) {
        const state = entry['advisory-state'];
        // Avoid-travel tiers only: state 2 (avoid non-essential) and 3 (avoid all).
        if (state !== 2 && state !== 3) continue;
        // World source: VI bbox filter deliberately skipped (world-event kind).
        const country = entry.eng?.name ?? entry['country-eng'] ?? iso;
        const advisoryText =
          entry.eng?.['advisory-text'] ??
          (state === 3 ? 'Avoid all travel' : 'Avoid non-essential travel');
        const publishedSec = entry['date-published']?.timestamp;
        const observedAt =
          typeof publishedSec === 'number' && publishedSec > 0 ? publishedSec * 1000 : fetchedAt;
        const updates = entry.eng?.['recent-updates']?.trim();
        signals.push({
          sourceSlug: META.slug,
          kind: 'world-event',
          title: `${country}: ${advisoryText}`.slice(0, 140),
          summary: updates ? updates.slice(0, 300) : undefined,
          severity: state === 3 ? 'warning' : 'watch',
          // country-level advisory, no coordinates — non-geographic signal
          observedAt,
          expiresAt: fetchedAt + WEEK_MS, // refreshed every sync while listed
          dedupeKey: `gac:${iso}`,
          confidence: 1.0, // agency feed (Global Affairs Canada)
          provenance: JSON.stringify({
            method: 'poll',
            fetchedAt,
            upstreamId: iso,
            url: entry.eng?.['url-slug']
              ? `https://travel.gc.ca/destinations/${entry.eng['url-slug']}`
              : URL,
          }),
          raw: JSON.stringify({
            iso,
            advisoryState: state,
            hasRegionalAdvisory: entry['has-regional-advisory'],
            recentUpdatesType: entry['recent-updates-type'],
            published: publishedSec,
          }).slice(0, 2000),
        });
      }

      // Cap 60: avoid-all-travel countries first, then most recently published.
      signals.sort(
        (a, b) =>
          (b.severity === 'warning' ? 1 : 0) - (a.severity === 'warning' ? 1 : 0) ||
          b.observedAt - a.observedAt,
      );
      await ctx.runMutation(internal.feeds.gacTravel.ingest, { signals: signals.slice(0, CAP) });
    } catch (e) {
      await ctx.runMutation(internal.feeds.gacTravel.fail, { error: String(e) });
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
