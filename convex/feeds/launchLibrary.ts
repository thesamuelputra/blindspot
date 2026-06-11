import { v } from 'convex/values';
import { internalAction, internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { fetchSource } from '../lib/fetchSource';
import { cellOf } from '../lib/geo';
import { upsertSignals, reportSuccess, reportFailure, type SignalInput, type SourceMeta } from '../lib/ingest';

// launch-library — SOURCES.md: Space (Objects). Launch Library 2 (The Space
// Devs) upcoming launches, v2.3.0 verified live 2026-06-11: default list mode
// includes pad.latitude/longitude as numbers plus status/net/rocket/mission.
// Signals kind 'launch', capped at 15 (the request limit). WORLD-MODE DATA:
// launch pads are global (Vandenberg, Cape, Wenchang…) and out-of-VI-bbox is
// FINE for kind 'launch' — the VI filter is deliberately skipped; south-VI
// occasionally sees Vandenberg launches at dusk and the SPACE page renders
// the rest as schedule context. Worst case 15 records/sync.
//
// Rate limit: 15 requests/hour unauthenticated, shared per IP — cadence is
// 3600s (1 req/hr) to leave headroom for any other TSD consumers. No auth.
const META: SourceMeta = {
  slug: 'launch-library',
  name: 'Launch Library 2 (The Space Devs)',
  cluster: 'Space (Objects)',
  cadenceSec: 3600,
  attribution: 'Data: The Space Devs / Launch Library 2',
};

const URL = 'https://ll.thespacedevs.com/2.3.0/launches/upcoming/?limit=15';

const DAY_MS = 24 * 3600 * 1000;

interface LlLaunch {
  id: string; // stable UUID
  url: string;
  name: string; // "Rocket | Mission" upstream composite
  status: { name: string; abbrev: string } | null;
  net: string | null; // canonical T-0, ISO8601 Z
  net_precision: { name: string } | null;
  probability: number | null;
  weather_concerns: string | null;
  launch_service_provider: { name: string; abbrev: string | null } | null;
  rocket: { configuration: { name: string; full_name: string | null } | null } | null;
  mission: { name: string; type: string | null; orbit: { abbrev: string | null } | null } | null;
  pad: {
    name: string;
    latitude: number | null;
    longitude: number | null;
    location: { name: string } | null;
  } | null;
}

export const sync = internalAction({
  args: {},
  handler: async (ctx) => {
    try {
      const res = await fetchSource(URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { results: LlLaunch[] };
      if (!Array.isArray(data.results)) throw new Error('unexpected payload: no results array');
      const fetchedAt = Date.now();

      const signals: SignalInput[] = [];
      for (const l of data.results.slice(0, 15)) {
        const net = l.net ? Date.parse(l.net) : NaN;
        const rocket = l.rocket?.configuration?.name;
        const mission = l.mission?.name;
        // Compose '<rocket> — <mission>'; fall back to the upstream composite
        // name (same content, '|'-separated) when either part is missing.
        const title = rocket && mission ? `${rocket} — ${mission}` : l.name;
        const lat = l.pad?.latitude;
        const lng = l.pad?.longitude;
        const summary =
          [
            l.status?.name,
            l.pad ? [l.pad.name, l.pad.location?.name].filter(Boolean).join(', ') : null,
            l.net_precision?.name ? `T-0 precision: ${l.net_precision.name}` : null,
          ]
            .filter(Boolean)
            .join(' · ')
            .slice(0, 300) || undefined;
        signals.push({
          sourceSlug: META.slug,
          kind: 'launch',
          title: title.slice(0, 140),
          summary,
          // Severity: launches are schedule context, never a VI hazard — flat
          // 'info' regardless of upstream status (no upstream severity scale).
          severity: 'info',
          // Pad coordinates, NOT VI-filtered (see header) — cell included so
          // the record stays self-consistent; it can never match a VI cell.
          ...(typeof lat === 'number' && typeof lng === 'number'
            ? { lat, lng, cell: cellOf(lat, lng) }
            : {}),
          observedAt: fetchedAt,
          ...(Number.isFinite(net) ? { startsAt: net, expiresAt: net + DAY_MS } : { expiresAt: fetchedAt + 7 * DAY_MS }),
          dedupeKey: `${META.slug}:${l.id}`,
          // 0.8 community tier: The Space Devs is a volunteer-curated
          // aggregation of agency schedules, not the agencies themselves.
          confidence: 0.8,
          provenance: JSON.stringify({ method: 'poll', fetchedAt, upstreamId: l.id, url: l.url }),
          raw: JSON.stringify({
            status: l.status?.abbrev,
            net: l.net,
            provider: l.launch_service_provider?.name,
            missionType: l.mission?.type,
            orbit: l.mission?.orbit?.abbrev,
            probability: l.probability,
            weather: l.weather_concerns?.slice(0, 200),
          }).slice(0, 2000),
        });
      }

      await ctx.runMutation(internal.feeds.launchLibrary.ingest, { signals });
    } catch (e) {
      await ctx.runMutation(internal.feeds.launchLibrary.fail, { error: String(e) });
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
