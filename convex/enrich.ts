import { v } from 'convex/values';
import { action, query, internalQuery, internalMutation } from './_generated/server';
import { internal } from './_generated/api';
import { lookupAircraftType } from './lib/aircraftTypes';
import { lookupFerry, FERRY_ROUTES } from './lib/ferryFleet';

const UA = 'BlindSpot/1.0 (personal OSINT console; samuel.putra101@gmail.com)';
const IDENTITY_TTL = 30 * 24 * 3600_000; // owner/type/photo are stable

async function getJson(url: string, timeoutMs = 8000): Promise<unknown | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Aircraft enrichment (Samuel's contract: a click shows what it is, who owns
// it, what it can carry, and where it is going). hexdb → identity, planespotters
// → photo, adsbdb → live route. Identity is cached 30d; route is fetched live.
export const aircraft = action({
  args: { hex: v.string(), callsign: v.optional(v.string()) },
  handler: async (ctx, { hex, callsign }) => {
    if ((await ctx.auth.getUserIdentity()) === null) return null;
    const key = `ac:${hex.toLowerCase()}`;

    const cached = (await ctx.runQuery(internal.enrich.getCache, { key })) as {
      json: string;
      fetchedAt: number;
    } | null;

    let identity: AircraftIdentity;
    if (cached && Date.now() - cached.fetchedAt < IDENTITY_TTL) {
      identity = JSON.parse(cached.json) as AircraftIdentity;
    } else {
      identity = await fetchAircraftIdentity(hex);
      await ctx.runMutation(internal.enrich.putCache, { key, json: JSON.stringify(identity) });
    }

    // live route (changes every flight) — best-effort, never blocks the identity
    let route: AircraftRoute | undefined;
    if (callsign && callsign.trim() && !/^[0-9a-f]{6}$/i.test(callsign.trim())) {
      const r = (await getJson(
        `https://api.adsbdb.com/v0/callsign/${encodeURIComponent(callsign.trim())}`,
        6000,
      )) as AdsbdbCallsign | null;
      const fr = r?.response?.flightroute;
      if (fr) {
        route = {
          airline: fr.airline?.name,
          origin: fr.origin ? `${fr.origin.iata_code} ${fr.origin.municipality ?? ''}`.trim() : undefined,
          destination: fr.destination
            ? `${fr.destination.iata_code} ${fr.destination.municipality ?? ''}`.trim()
            : undefined,
        };
      }
    }

    const spec = lookupAircraftType(identity.icaoType);
    return { ...identity, spec, route };
  },
});

interface AircraftIdentity {
  registration?: string;
  icaoType?: string;
  typeName?: string;
  manufacturer?: string;
  owner?: string;
  photo?: { thumb: string; large?: string; link: string; photographer?: string };
}
interface AircraftRoute {
  airline?: string;
  origin?: string;
  destination?: string;
}
interface HexdbAircraft {
  Registration?: string;
  ICAOTypeCode?: string;
  Type?: string;
  Manufacturer?: string;
  RegisteredOwners?: string;
}
interface AdsbdbCallsign {
  response?: {
    flightroute?: {
      airline?: { name?: string };
      origin?: { iata_code?: string; municipality?: string };
      destination?: { iata_code?: string; municipality?: string };
    };
  };
}
interface PlanespottersResp {
  photos?: Array<{
    thumbnail?: { src?: string };
    thumbnail_large?: { src?: string };
    link?: string;
    photographer?: string;
  }>;
}

async function fetchAircraftIdentity(hex: string): Promise<AircraftIdentity> {
  const h = (await getJson(`https://hexdb.io/api/v1/aircraft/${encodeURIComponent(hex)}`)) as HexdbAircraft | null;
  const identity: AircraftIdentity = {
    registration: h?.Registration,
    icaoType: h?.ICAOTypeCode,
    typeName: h?.Type,
    manufacturer: h?.Manufacturer,
    owner: h?.RegisteredOwners,
  };
  // photo by registration (planespotters, attribution required)
  if (identity.registration) {
    const p = (await getJson(
      `https://api.planespotters.net/pub/photos/reg/${encodeURIComponent(identity.registration)}`,
    )) as PlanespottersResp | null;
    const photo = p?.photos?.[0];
    if (photo?.thumbnail?.src) {
      identity.photo = {
        thumb: photo.thumbnail.src,
        large: photo.thumbnail_large?.src,
        link: photo.link ?? '',
        photographer: photo.photographer,
      };
    }
  }
  return identity;
}

// Ferry enrichment — pure static lookup (fleet specs + route decode).
export const ferry = query({
  args: { extId: v.string(), route: v.optional(v.string()) },
  handler: async (ctx, { extId, route }) => {
    if ((await ctx.auth.getUserIdentity()) === null) return null;
    const spec = lookupFerry(extId);
    const routeName = route ? (FERRY_ROUTES[route] ?? route) : undefined;
    if (!spec && !routeName) return null;
    return { spec, routeName };
  },
});

export const getCache = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    return await ctx.db
      .query('enrichments')
      .withIndex('by_key', (q) => q.eq('key', key))
      .unique();
  },
});

export const putCache = internalMutation({
  args: { key: v.string(), json: v.string() },
  handler: async (ctx, { key, json }) => {
    const existing = await ctx.db
      .query('enrichments')
      .withIndex('by_key', (q) => q.eq('key', key))
      .unique();
    if (existing) await ctx.db.patch(existing._id, { json, fetchedAt: Date.now() });
    else await ctx.db.insert('enrichments', { key, json, fetchedAt: Date.now() });
  },
});
