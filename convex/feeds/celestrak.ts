import { v } from 'convex/values';
import { internalAction, internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { fetchSource } from '../lib/fetchSource';
import { writeSnapshot } from '../lib/movers';
import { reportSuccess, reportFailure, type SourceMeta } from '../lib/ingest';

// celestrak — SOURCES.md: Space (Objects). GP element sets (TLE/OMM as JSON)
// for the `stations` group (ISS etc., 25 objects / ~10KB verified) and the
// `visual` group (148 objects / ~62KB verified — under the 100KB inclusion
// guard). Raw arrays are stored verbatim in snapshots `tle:stations` and
// `tle:visual`; the SPACE page (Phase 5) propagates positions client-side
// with satellite.js, so no signals/readings/entities here. No map layer.
//
// CADENCE IS DAILY (86400s) AND MUST NOT BE RAISED — CelesTrak etiquette is
// actively enforced as of 2026: data refreshes only every 2h, premature
// same-GROUP re-downloads get a warning page instead of JSON (parse guard
// below), and error spam triggers firewall blocks. The site sends no
// Last-Modified/ETag (verified), so conditional GET is not available; the
// daily cron IS the politeness mechanism. Worst case ~175 GP records/sync.
// No auth. Cluster build notes say one-man-operated IIS server: be gentle.
const META: SourceMeta = {
  slug: 'celestrak',
  name: 'CelesTrak GP Elements (TLE)',
  cluster: 'Space (Objects)',
  cadenceSec: 86400,
  attribution: 'CelesTrak (celestrak.org), Dr. T.S. Kelso',
  licenseNote: 'No explicit license; freely available per CelesTrak docs, attribution courteous',
};

const GP_URL = (group: string) =>
  `https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=json`;

// Hard guard from the build spec: only persist the visual group while it
// stays under 100KB (it was 61,837 bytes on 2026-06-11).
const VISUAL_MAX_BYTES = 100_000;

interface GpRecord {
  OBJECT_NAME: string;
  NORAD_CAT_ID: number;
  EPOCH: string;
  // ...plus the full OMM field set; stored verbatim, never reshaped.
}

// CelesTrak's premature-re-download "warning response" arrives with HTTP 200
// but is not a JSON array — treat anything unparseable/non-array as missing
// data rather than throwing parse errors at the health row.
async function fetchGroup(group: string): Promise<{ json: string; count: number } | null> {
  const res = await fetchSource(GP_URL(group));
  if (!res.ok) throw new Error(`HTTP ${res.status} for GROUP=${group}`);
  const text = await res.text();
  try {
    const parsed = JSON.parse(text) as GpRecord[];
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    return { json: text, count: parsed.length };
  } catch {
    return null; // warning page, not GP data
  }
}

export const sync = internalAction({
  args: {},
  handler: async (ctx) => {
    try {
      // stations is the primary product (ISS ground track depends on it) —
      // its failure fails the sync. visual is best-effort: skipped when
      // oversized, throttled, or replaced by a warning page.
      const stations = await fetchGroup('stations');
      if (!stations) throw new Error('stations group returned no GP array (warning response?)');

      let visual: { json: string; count: number } | null = null;
      try {
        const fetched = await fetchGroup('visual');
        if (fetched && fetched.json.length <= VISUAL_MAX_BYTES) visual = fetched;
      } catch {
        // best-effort only — stations alone is a successful sync
      }

      await ctx.runMutation(internal.feeds.celestrak.ingest, {
        stationsJson: stations.json,
        visualJson: visual?.json,
        count: stations.count + (visual?.count ?? 0),
      });
    } catch (e) {
      await ctx.runMutation(internal.feeds.celestrak.fail, { error: String(e) });
    }
  },
});

export const ingest = internalMutation({
  args: {
    stationsJson: v.string(),
    visualJson: v.optional(v.string()),
    count: v.number(),
  },
  handler: async (ctx, { stationsJson, visualJson, count }) => {
    await writeSnapshot(ctx, 'tle:stations', stationsJson);
    if (visualJson) await writeSnapshot(ctx, 'tle:visual', visualJson);
    await reportSuccess(ctx, META, count);
  },
});

export const fail = internalMutation({
  args: { error: v.string() },
  handler: async (ctx, { error }) => {
    await reportFailure(ctx, META, error);
  },
});
