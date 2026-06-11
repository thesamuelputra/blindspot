import { v } from 'convex/values';
import { internalAction, internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { fetchSource } from '../lib/fetchSource';
import { VI_BBOX, inBbox } from '../lib/geo';
import { upsertMovers, type MoverInput } from '../lib/movers';
import { reportSuccess, reportFailure, type SourceMeta } from '../lib/ingest';

// adsb-aircraft — DECISIONS D12: community aggregator trio behind one
// readsb-shape adapter with failover (adsb.fi → adsb.lol → airplanes.live).
// All three serve the same readsb /v2 point-radius shape, keyless.
// Worst case ~250 aircraft in radius; bbox filter trims to ~30-150.
// Cadence: fast lane (~120s) — D8 budget line "aircraft".
const META: SourceMeta = {
  slug: 'adsb-aircraft',
  name: 'ADS-B (adsb.fi / adsb.lol / airplanes.live)',
  cluster: 'Skies (Air)',
  cadenceSec: 120,
  attribution: 'adsb.fi · adsb.lol · airplanes.live (community ADS-B)',
};

// 165nm from the Island centroid covers the whole VI bbox with margin.
const CENTER = { lat: 49.35, lng: -124.4 };
const RADIUS_NM = 165;

// ICAO type designators that are rotorcraft (common in BC airspace: air
// ambulance, Coast Guard, RCAF Cormorant, utility + heli-logging types).
const HELI_TYPES = new Set([
  'B06', 'B47', 'B105', 'B212', 'B214', 'B412', 'B429', 'B505',
  'R22', 'R44', 'R66',
  'S61', 'S76', 'S92',
  'EC20', 'EC25', 'EC30', 'EC35', 'EC45', 'EC55', 'EC75', 'EC120', 'EC130',
  'AS50', 'AS55', 'AS65', 'H125', 'H130', 'H135', 'H145', 'H160', 'H175',
  'A109', 'A119', 'A139', 'A169', 'A189', 'AW09', 'AW39',
  'CH47', 'H47', 'H53', 'H60', 'H64', 'UH1', 'UH1Y',
  'MD52', 'MD60', 'BK17', 'EN28', 'EXPL', 'EH10', 'CL60H',
]);

const PROVIDERS = [
  `https://opendata.adsb.fi/api/v2/lat/${CENTER.lat}/lon/${CENTER.lng}/dist/${RADIUS_NM}`,
  `https://api.adsb.lol/v2/lat/${CENTER.lat}/lon/${CENTER.lng}/dist/${RADIUS_NM}`,
  `https://api.airplanes.live/v2/point/${CENTER.lat}/${CENTER.lng}/${RADIUS_NM}`,
];

interface ReadsbAircraft {
  hex: string;
  flight?: string;
  r?: string; // registration
  t?: string; // type designator
  lat?: number;
  lon?: number;
  alt_baro?: number | 'ground';
  gs?: number;
  track?: number;
  squawk?: string;
  category?: string;
  dbFlags?: number; // bit 0 = military (readsb convention)
}

export const sync = internalAction({
  args: {},
  handler: async (ctx) => {
    let lastError = 'no provider reachable';
    for (const url of PROVIDERS) {
      try {
        const res = await fetchSource(url, { retries: 0 });
        if (!res.ok) {
          lastError = `HTTP ${res.status} from ${new URL(url).host}`;
          continue;
        }
        // readsb deployments differ: adsb.lol/airplanes.live use "ac",
        // adsb.fi uses "aircraft" (verified live 2026-06-11)
        const data = (await res.json()) as {
          ac?: ReadsbAircraft[];
          aircraft?: ReadsbAircraft[];
          now?: number;
        };
        const at = Date.now();
        const movers: MoverInput[] = (data.ac ?? data.aircraft ?? [])
          .filter(
            (a) =>
              typeof a.lat === 'number' &&
              typeof a.lon === 'number' &&
              inBbox(a.lat, a.lon, VI_BBOX),
          )
          .map((a) => ({
            extId: a.hex,
            // adsb.fi emits "00000000" for missing callsigns — fall through to reg
            label: [a.flight, a.r, a.hex]
              .map((x) => x?.trim())
              .find((x) => x && !/^0+$/.test(x))!,
            // marker identity: rotorcraft get their own icon; military gets
            // amber. ADS-B emitter category A7 = rotorcraft; the type-designator
            // set catches helis broadcasting a generic category.
            cat: a.category === 'A7' || HELI_TYPES.has(a.t ?? '') ? 'heli' : 'plane',
            mil: ((a.dbFlags ?? 0) & 1) === 1,
            lat: a.lat!,
            lng: a.lon!,
            heading: a.track,
            speed: a.gs,
            altitude: a.alt_baro === 'ground' ? 0 : a.alt_baro,
            state: JSON.stringify({
              squawk: a.squawk,
              type: a.t,
              reg: a.r,
              category: a.category,
              mil: ((a.dbFlags ?? 0) & 1) === 1,
              ground: a.alt_baro === 'ground',
            }),
            at,
          }));
        await ctx.runMutation(internal.feeds.adsbAircraft.ingest, {
          movers,
          provider: new URL(url).host,
        });
        return;
      } catch (e) {
        lastError = String(e);
      }
    }
    await ctx.runMutation(internal.feeds.adsbAircraft.fail, { error: lastError });
  },
});

export const ingest = internalMutation({
  args: { movers: v.array(v.any()), provider: v.string() },
  handler: async (ctx, { movers, provider }) => {
    const count = await upsertMovers(ctx, 'aircraft', META.slug, movers as MoverInput[]);
    await reportSuccess(ctx, { ...META, name: `ADS-B (${provider})` }, count);
  },
});

export const fail = internalMutation({
  args: { error: v.string() },
  handler: async (ctx, { error }) => {
    await reportFailure(ctx, META, error);
  },
});
