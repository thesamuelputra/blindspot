import { v } from 'convex/values';
import { internalAction, internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { fetchSource } from '../lib/fetchSource';
import { reportSuccess, reportFailure, type SourceMeta } from '../lib/ingest';

// orcasound — SOURCES.md: Cameras & Live Media. Live Salish Sea hydrophone
// network (live.orcasound.net, orcasite backend). Feeds list is JSON:API at
// https://live.orcasound.net/api/json/feeds; rows land in `cameras` with
// kind 'audio'.
//
// mediaUrl is the node's S3 BASE, e.g.
//   https://audio-orcasound-net.s3.amazonaws.com/rpi_orcasound_lab
// NOT a playable URL by itself. Per the SOURCES gotcha the client LiveMedia
// resolver must: GET <base>/latest.txt → unix timestamp naming the current
// folder → play <base>/hls/<timestamp>/live.m3u8 via hls.js (S3 has ACAO:*).
// The hls/<timestamp> folder rolls over, so the resolver re-reads latest.txt
// on start and on stream stall — never caches the folder forever.
//
// Node selection: visible=true AND latitude >= 48.0°N. That keeps the two
// in-bbox Haro Strait nodes (orcasound-lab, andrews-bay — both directly
// facing VI / the Victoria shipping approaches) plus the three adjacent ones
// SOURCES calls out (north-sjc, port-townsend, bush-point). Those three sit
// just outside VI_BBOX but monitor the same shared VI waters — the Southern
// Resident corridor through San Juan Channel and the Admiralty Inlet /
// Juan de Fuca approaches — so they earn a deliberate bbox exemption.
// Central Puget Sound nodes (< 48°N: sunset-bay, mast-center, …) stay out.
// Worst case: 9 nodes upstream today → ≤ 9 camera rows.
const META: SourceMeta = {
  slug: 'orcasound',
  name: 'Orcasound Salish Sea Hydrophones',
  cluster: 'Cameras & Live Media',
  cadenceSec: 3600,
  attribution: 'Orcasound (live.orcasound.net) + hydrophone host orgs',
  licenseNote:
    'Audio license unstated upstream — treat as free-to-listen with attribution (orcasite code is AGPL-3.0)',
};

const FEEDS_URL = 'https://live.orcasound.net/api/json/feeds';
const DEFAULT_BUCKET = 'audio-orcasound-net';
// Salish Sea adjacency line — see node-selection comment above.
const MIN_LAT = 48.0;

// JSON:API resource: attributes verified live 2026-06-11.
interface FeedAttributes {
  name?: string;
  slug?: string;
  node_name?: string;
  visible?: boolean;
  bucket?: string;
  intro_html?: string | null;
  // GeoJSON Point — coordinates are [lng, lat] (verified; do not swap back).
  location_point?: { type?: string; coordinates?: [number, number] };
}

export interface CameraInput {
  slug: string;
  name: string;
  lat: number;
  lng: number;
  mediaUrl: string;
  attribution: string;
}

// Pull the host org out of intro_html free text. Verified phrasings:
//   "Orcasound Lab is hosted by Val and Leslie Veirs and funded by Beam Reach."
//   "The node is hosted by the Port Townsend Marine Science Center."
//   "The hydrophone is hosted and maintained by the Orca Behavior Institute (OBI)."
//   "The Bush Point node is hosted by Orca Network with logistical support from…"
// andrews-bay has no host credit → undefined → plain Orcasound attribution.
function hostOrg(introHtml: string | null | undefined): string | undefined {
  if (!introHtml) return undefined;
  const text = introHtml
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const m = /hosted(?:\s+and\s+maintained)?\s+by\s+(?:the\s+)?(.{3,80}?)\s*(?:\band funded\b|\bwith\b|[.,])/i.exec(
    text,
  );
  return m ? m[1].trim() : undefined;
}

export const sync = internalAction({
  args: {},
  handler: async (ctx) => {
    try {
      const res = await fetchSource(FEEDS_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { data?: Array<{ attributes?: FeedAttributes }> };
      if (!Array.isArray(body.data)) throw new Error('unexpected feeds shape (no data array)');

      const cams: CameraInput[] = [];
      for (const row of body.data) {
        const a = row.attributes;
        if (!a?.node_name || a.visible !== true) continue; // SOURCES gotcha 4: filter visible
        const coords = a.location_point?.coordinates;
        if (!coords || coords.length < 2) continue;
        const [lng, lat] = coords; // GeoJSON order
        if (lat < MIN_LAT) continue; // Puget Sound — out of scope
        const host = hostOrg(a.intro_html);
        cams.push({
          slug: `orcasound:${a.node_name}`,
          name: a.name || a.node_name,
          lat,
          lng,
          mediaUrl: `https://${a.bucket || DEFAULT_BUCKET}.s3.amazonaws.com/${a.node_name}`,
          attribution: host ? `Orcasound (live.orcasound.net) · ${host}` : 'Orcasound (live.orcasound.net)',
        });
      }
      await ctx.runMutation(internal.feeds.orcasound.ingest, { cams });
    } catch (e) {
      await ctx.runMutation(internal.feeds.orcasound.fail, { error: String(e) });
    }
  },
});

export const ingest = internalMutation({
  args: { cams: v.array(v.any()) },
  handler: async (ctx, args) => {
    const cams = args.cams as CameraInput[];
    let inserted = 0;
    let updated = 0;
    for (const c of cams) {
      const existing = await ctx.db
        .query('cameras')
        .withIndex('by_slug', (q) => q.eq('slug', c.slug))
        .unique();
      const fields = {
        name: c.name,
        lat: c.lat,
        lng: c.lng,
        kind: 'audio' as const,
        mediaUrl: c.mediaUrl,
        sourceSlug: META.slug,
        attribution: c.attribution,
        active: true,
      };
      if (existing) {
        await ctx.db.patch(existing._id, fields);
        updated++;
      } else {
        await ctx.db.insert('cameras', { slug: c.slug, ...fields });
        inserted++;
      }
    }
    // Nodes that leave the feeds list (or flip visible=false) go inactive —
    // never deleted. Cameras table is small; full collect + filter is fine.
    const present = new Set(cams.map((c) => c.slug));
    const all = await ctx.db.query('cameras').collect();
    for (const row of all) {
      if (row.sourceSlug === META.slug && row.active && !present.has(row.slug)) {
        await ctx.db.patch(row._id, { active: false });
      }
    }
    await reportSuccess(ctx, META, cams.length);
    return { inserted, updated };
  },
});

export const fail = internalMutation({
  args: { error: v.string() },
  handler: async (ctx, { error }) => {
    await reportFailure(ctx, META, error);
  },
});
