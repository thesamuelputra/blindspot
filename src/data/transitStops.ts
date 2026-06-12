// Lazy loader for the BC Transit bus-stops index built by
// scripts/gtfs-stops.mjs (public/data/transit-stops.json). Powers the "click a
// bus → see its route's stops" flow: the bus mover's state carries routeId (the
// GTFS route_id, e.g. "1-VIC", set in convex/feeds/bcTransit.ts), and the
// inspector/map call getRouteStops(state.routeId) to draw the stop list and the
// map dots. Attribution required wherever this renders: "BC Transit".

export interface BusStop {
  name: string;
  lat: number;
  lng: number;
}

export interface RouteStops {
  short: string;
  long: string;
  stops: BusStop[];
}

type TransitStopsIndex = Record<string, RouteStops>;

// The whole index is ~200KB, so it's fetched once and the promise is cached at
// module scope — every getRouteStops call after the first resolves instantly off
// the same in-flight/settled fetch. On failure we cache null so we don't hammer
// a broken endpoint on every bus click (a later reload picks it up again).
let indexPromise: Promise<TransitStopsIndex | null> | null = null;

function loadIndex(): Promise<TransitStopsIndex | null> {
  if (indexPromise) return indexPromise;
  indexPromise = fetch('/data/transit-stops.json')
    .then((res) => (res.ok ? (res.json() as Promise<TransitStopsIndex>) : null))
    .catch(() => null);
  return indexPromise;
}

/**
 * Resolve the ordered stop list for a GTFS route_id (the bus mover's
 * state.routeId). Returns null when the route is unknown, routeId is empty, or
 * the index failed to load. Safe to call on every inspected bus.
 */
export async function getRouteStops(routeId: string | undefined | null): Promise<RouteStops | null> {
  if (!routeId) return null;
  const index = await loadIndex();
  return index?.[routeId] ?? null;
}
