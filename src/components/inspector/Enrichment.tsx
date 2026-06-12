import { useEffect, useState } from 'react';
import { useAction, useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import { useUi } from '@/state/ui';

// Intrinsic detail panels (Samuel's contract: a click shows what the thing IS,
// who owns it, what it carries, where it is going). Aircraft enrichment is an
// action (external APIs, cached server-side); ferry is a static lookup.

function Field({ k, v }: { k: string; v: string | number | undefined | null }) {
  if (v === undefined || v === null || v === '') return null;
  return (
    <div style={{ display: 'flex', gap: 8, padding: '3px 0', borderBottom: '1px solid var(--border-hairline)' }}>
      <span className="microlabel" style={{ width: 92, flexShrink: 0, paddingTop: 2 }}>
        {k}
      </span>
      <span className="mono" style={{ color: 'var(--text-1)', wordBreak: 'break-word' }}>
        {String(v)}
      </span>
    </div>
  );
}

interface AircraftEnrichment {
  registration?: string;
  typeName?: string;
  manufacturer?: string;
  owner?: string;
  photo?: { thumb: string; large?: string; link: string; photographer?: string };
  spec?: {
    name: string;
    role: string;
    pax?: number;
    engines?: string;
    cruiseKt?: number;
    mtowKg?: number;
  } | null;
  route?: {
    airline?: string;
    origin?: string;
    destination?: string;
    originLat?: number;
    originLng?: number;
    destLat?: number;
    destLng?: number;
  };
}

export function AircraftEnrichmentPanel({
  hex,
  callsign,
  lat,
  lng,
}: {
  hex: string;
  callsign?: string;
  lat?: number;
  lng?: number;
}) {
  const enrich = useAction(api.enrich.aircraft);
  const setFlightRoute = useUi((s) => s.setFlightRoute);
  const [data, setData] = useState<AircraftEnrichment | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setData(null);
    void enrich({ hex, callsign })
      .then((r) => {
        if (!live) return;
        const d = r as AircraftEnrichment | null;
        setData(d);
        // publish the planned flight path for MapView to draw
        const rt = d?.route;
        if (rt?.originLat != null && rt.destLat != null && lat != null && lng != null) {
          setFlightRoute({
            originLat: rt.originLat,
            originLng: rt.originLng!,
            originName: rt.origin,
            destLat: rt.destLat,
            destLng: rt.destLng!,
            destName: rt.destination,
            curLat: lat,
            curLng: lng,
          });
        } else {
          setFlightRoute(null);
        }
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
      setFlightRoute(null);
    };
  }, [enrich, hex, callsign, lat, lng, setFlightRoute]);

  if (loading) {
    return (
      <div className="microlabel" style={{ padding: '8px 0' }}>
        RESOLVING AIRFRAME…
      </div>
    );
  }
  if (!data || (!data.owner && !data.photo && !data.spec && !data.typeName && !data.route?.origin))
    return null;

  return (
    <div style={{ marginBottom: 10 }}>
      {data.photo && (
        <a href={data.photo.link} target="_blank" rel="noreferrer" style={{ display: 'block' }}>
          <img
            src={data.photo.large ?? data.photo.thumb}
            alt={data.typeName ?? 'aircraft'}
            style={{ width: '100%', display: 'block', border: '1px solid var(--border-hairline)' }}
          />
          {data.photo.photographer && (
            <div className="microlabel" style={{ padding: '3px 0', color: 'var(--text-3)' }}>
              PHOTO · {data.photo.photographer} / planespotters.net
            </div>
          )}
        </a>
      )}
      <Field k="TYPE" v={data.spec?.name ?? data.typeName} />
      <Field k="OPERATOR" v={data.owner} />
      <Field k="REG" v={data.registration} />
      {data.route?.airline && <Field k="AIRLINE" v={data.route.airline} />}
      {data.route?.origin && <Field k="FROM" v={data.route.origin} />}
      {data.route?.destination && <Field k="TO" v={data.route.destination} />}
      <Field k="MAX PAX" v={data.spec?.pax} />
      <Field k="ENGINES" v={data.spec?.engines} />
      <Field k="CRUISE" v={data.spec?.cruiseKt ? `${data.spec.cruiseKt} kt` : undefined} />
    </div>
  );
}

// Bus route stops (Samuel: clicking a bus shows its route's stops). Reads the
// route from the bus's state (already in the inspector), looks up the GTFS
// stop list, lists them, and publishes them to the map for stop dots.
export function BusStopsPanel({ routeId }: { routeId?: string }) {
  const setBusStops = useUi((s) => s.setBusStops);
  const [route, setRoute] = useState<import('@/data/transitStops').RouteStops | null>(null);

  useEffect(() => {
    let live = true;
    setRoute(null);
    void import('@/data/transitStops').then(({ getRouteStops }) =>
      getRouteStops(routeId).then((r) => {
        if (!live) return;
        setRoute(r);
        setBusStops(r?.stops ?? null);
      }),
    );
    return () => {
      live = false;
      setBusStops(null);
    };
  }, [routeId, setBusStops]);

  if (!route) return null;
  return (
    <div style={{ marginTop: 10 }}>
      <div className="microlabel">
        ROUTE {route.short} · {route.stops.length} STOPS (on map)
      </div>
      <ol
        className="mono"
        style={{
          margin: '6px 0 0',
          padding: '0 0 0 18px',
          maxHeight: 200,
          overflowY: 'auto',
          fontSize: 11,
          color: 'var(--text-2)',
          lineHeight: 1.7,
        }}
      >
        {route.stops.map((s, i) => (
          <li key={i}>{s.name}</li>
        ))}
      </ol>
      <div className="microlabel" style={{ marginTop: 4, color: 'var(--text-3)' }}>
        BC TRANSIT
      </div>
    </div>
  );
}

interface FerryEnrichment {
  spec?: {
    name: string;
    class?: string;
    builtYear?: number;
    carCapacity?: number;
    passengerCapacity?: number;
    lengthM?: number;
    serviceSpeedKn?: number;
  } | null;
  routeName?: string;
}

export function FerryEnrichmentPanel({ extId, route }: { extId: string; route?: string }) {
  const data = useQuery(api.enrich.ferry, { extId, route }) as FerryEnrichment | null | undefined;
  if (!data || (!data.spec && !data.routeName)) return null;
  const s = data.spec;
  return (
    <div style={{ marginBottom: 10 }}>
      {data.routeName && <Field k="ROUTE" v={data.routeName} />}
      {s && (
        <>
          <Field k="CLASS" v={s.class ? `${s.class} class` : undefined} />
          <Field k="BUILT" v={s.builtYear} />
          <Field k="VEHICLES" v={s.carCapacity ? `${s.carCapacity} cars` : undefined} />
          <Field k="PASSENGERS" v={s.passengerCapacity} />
          <Field k="LENGTH" v={s.lengthM ? `${s.lengthM} m` : undefined} />
          <Field k="SERVICE SPD" v={s.serviceSpeedKn ? `${s.serviceSpeedKn} kn` : undefined} />
        </>
      )}
    </div>
  );
}
