import type { MutationCtx } from '../_generated/server';
import { distanceMeters } from './geo';

// Shared mover ingestion (ARCHITECTURE §5.10/§11): upsert entities, append
// displacement-gated tracks, and refresh the compact positions snapshot the
// client subscribes to (never raw entity scans).

export interface MoverInput {
  extId: string;
  label: string;
  lat: number;
  lng: number;
  heading?: number;
  speed?: number;
  altitude?: number;
  state?: string; // kind-specific JSON
  at: number;
  // marker identity (Samuel's contract: markers show what a thing IS):
  tag?: string; // short display tag — bus route "22A", ferry route code…
  cat?: string; // category for icon/color — plane|heli|bus|ferry|balloon|cargo|tanker|tug|passenger|fishing|pleasure…
  mil?: boolean; // military aircraft flag (readsb dbFlags)
}

const TRACK_MIN_METERS = 50;

export async function upsertMovers(
  ctx: MutationCtx,
  kind: string,
  sourceSlug: string,
  movers: MoverInput[],
): Promise<number> {
  for (const m of movers) {
    const existing = await ctx.db
      .query('entities')
      .withIndex('by_ext', (q) => q.eq('kind', kind).eq('extId', m.extId))
      .unique();
    if (existing) {
      const moved = distanceMeters(existing.lat, existing.lng, m.lat, m.lng);
      await ctx.db.patch(existing._id, {
        label: m.label,
        lat: m.lat,
        lng: m.lng,
        heading: m.heading,
        speed: m.speed,
        altitude: m.altitude,
        state: m.state,
        lastSeenAt: m.at,
        stale: false,
      });
      if (moved >= TRACK_MIN_METERS) {
        await ctx.db.insert('tracks', {
          entityId: existing._id,
          at: m.at,
          lat: m.lat,
          lng: m.lng,
          heading: m.heading,
          speed: m.speed,
          altitude: m.altitude,
        });
      }
    } else {
      const id = await ctx.db.insert('entities', {
        kind,
        extId: m.extId,
        label: m.label,
        sourceSlug,
        lat: m.lat,
        lng: m.lng,
        heading: m.heading,
        speed: m.speed,
        altitude: m.altitude,
        state: m.state,
        firstSeenAt: m.at,
        lastSeenAt: m.at,
        stale: false,
        watch: false,
      });
      await ctx.db.insert('tracks', {
        entityId: id,
        at: m.at,
        lat: m.lat,
        lng: m.lng,
        heading: m.heading,
        speed: m.speed,
        altitude: m.altitude,
      });
    }
  }
  await writeSnapshot(
    ctx,
    `positions:${kind}`,
    JSON.stringify(
      movers.map((m) => ({
        id: m.extId,
        label: m.label,
        lat: m.lat,
        lng: m.lng,
        h: m.heading,
        s: m.speed,
        a: m.altitude,
        t: m.tag,
        c: m.cat,
        m: m.mil || undefined,
      })),
    ),
  );
  return movers.length;
}

export async function writeSnapshot(ctx: MutationCtx, key: string, json: string): Promise<void> {
  const row = await ctx.db
    .query('snapshots')
    .withIndex('by_key', (q) => q.eq('key', key))
    .unique();
  if (row) await ctx.db.patch(row._id, { json, updatedAt: Date.now() });
  else await ctx.db.insert('snapshots', { key, json, updatedAt: Date.now() });
}
