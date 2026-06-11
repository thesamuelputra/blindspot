import { v } from 'convex/values';
import { internalAction, internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { fetchSource } from '../lib/fetchSource';
import {
  insertReadings,
  reportSuccess,
  reportFailure,
  type ReadingInput,
  type SourceMeta,
} from '../lib/ingest';

// avalanche-canada — SOURCES.md: Environment & Conditions. Point forecast for
// the central VI mountains (the catalog-verified coordinate; query param is
// `long`, not lon/lng). No auth, CloudFront-cached. In season (~late Nov to
// late Apr) dangerRatings carry daily alp/tln/btl ratings; off-season the API
// returns 200 with a static 'Spring Conditions' product whose rating values
// are non-numeric ('spring'/'noRating') — that is a count-0 success, not a
// failure. Worst case 3 readings/sync. Cadence: 21600s (issued once daily).
const META: SourceMeta = {
  slug: 'avalanche-canada',
  name: 'Avalanche Canada Forecast (VI point)',
  cluster: 'Environment & Conditions',
  cadenceSec: 21600,
  attribution: 'Avalanche Canada',
};

const POINT = { lat: 49.7, lng: -125.4 }; // Forbidden Plateau / central island mountains
const URL = `https://api.avalanche.ca/forecasts/en/products/point?lat=${POINT.lat}&long=${POINT.lng}`;

// North American Public Avalanche Danger Scale → numeric reading. Off-season
// values ('spring', 'earlySeason', 'noRating', …) have no numeric equivalent
// and are skipped — the off-season product is handled, not an error.
const DANGER: Record<string, number> = {
  low: 1,
  moderate: 2,
  considerable: 3,
  high: 4,
  extreme: 5,
};

// Three elevation bands as three stations (spec): alp/tln/btl.
const BANDS = ['alp', 'tln', 'btl'] as const;

interface PointProduct {
  report?: {
    dateIssued?: string;
    dangerRatings?: Array<{
      date?: { value?: string };
      ratings?: Partial<
        Record<(typeof BANDS)[number], { rating?: { value?: string; display?: string } }>
      >;
    }>;
  };
}

export const sync = internalAction({
  args: {},
  handler: async (ctx) => {
    try {
      const res = await fetchSource(URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as PointProduct;
      const fetchedAt = Date.now();

      const readings: ReadingInput[] = [];
      // First dangerRatings entry = today's forecast day.
      const today = data.report?.dangerRatings?.[0];
      const issued = data.report?.dateIssued ? Date.parse(data.report.dateIssued) : NaN;
      const dayAt = today?.date?.value ? Date.parse(today.date.value) : NaN;
      const at = Number.isFinite(dayAt) ? dayAt : Number.isFinite(issued) ? issued : fetchedAt;

      for (const band of BANDS) {
        const value = today?.ratings?.[band]?.rating?.value?.toLowerCase();
        const numeric = value !== undefined ? DANGER[value] : undefined;
        if (numeric === undefined) continue; // off-season / no rating
        readings.push({
          stationId: `${META.slug}:${band}`,
          metric: 'avalanche_danger',
          value: numeric,
          unit: 'danger (1-5)',
          at,
          lat: POINT.lat,
          lng: POINT.lng,
          sourceSlug: META.slug,
        });
      }

      await ctx.runMutation(internal.feeds.avalancheCanada.ingest, { readings });
    } catch (e) {
      await ctx.runMutation(internal.feeds.avalancheCanada.fail, { error: String(e) });
    }
  },
});

export const ingest = internalMutation({
  args: { readings: v.array(v.any()) },
  handler: async (ctx, { readings }) => {
    const inserted = await insertReadings(ctx, readings as ReadingInput[]);
    await reportSuccess(ctx, META, readings.length);
    return { inserted };
  },
});

export const fail = internalMutation({
  args: { error: v.string() },
  handler: async (ctx, { error }) => {
    await reportFailure(ctx, META, error);
  },
});
