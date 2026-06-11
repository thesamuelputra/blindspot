'use node';
import { internalAction } from '../_generated/server';
import { internal } from '../_generated/api';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import { fetchSource } from '../lib/fetchSource';
import { VI_BBOX, inBbox } from '../lib/geo';
import type { MoverInput } from '../lib/movers';
import type { SignalInput } from '../lib/ingest';

// bc-transit — SOURCES.md: Ground (Mobility). GTFS-Realtime protobuf via the
// vendor-hosted Tmix endpoint, no auth. VICTORIA REGIONAL ONLY this wave
// (operatorIds=48); other Island systems (10,11,12,17,41,45) come later.
// Decodes with gtfs-realtime-bindings, hence "use node" — the ingest
// mutations live in feeds/bcTransitIngest.ts (default runtime).
// Worst case ~250 vehicles at peak (observed 207 on 2026-06-11) + ~20-40
// service alerts. Cadence: fast lane (120s proposed; SOURCES.md notes 60s
// as community-standard for these feeds).
const SLUG = 'bc-transit';

const VEHICLES_URL = 'https://bct.tmix.se/gtfs-realtime/vehicleupdates.pb?operatorIds=48';
const ALERTS_URL = 'https://bct.tmix.se/gtfs-realtime/alerts.pb?operatorIds=48';

const rt = GtfsRealtimeBindings.transit_realtime;
const StopStatus = rt.VehiclePosition.VehicleStopStatus;
const SeverityLevel = rt.Alert.SeverityLevel;
const Cause = rt.Alert.Cause;
const Effect = rt.Alert.Effect;

// protobufjs decodes 64-bit ints as Long objects (timestamps here).
function num(x: number | string | { toNumber(): number } | null | undefined): number | undefined {
  if (x == null) return undefined;
  if (typeof x === 'number') return x;
  if (typeof x === 'string') {
    const n = Number(x);
    return Number.isFinite(n) ? n : undefined;
  }
  return x.toNumber();
}

function firstText(
  ts?: { translation?: ({ text?: string | null } | null)[] | null } | null,
): string | undefined {
  const t = ts?.translation?.[0]?.text;
  return t ?? undefined;
}

async function fetchFeed(url: string) {
  const res = await fetchSource(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return rt.FeedMessage.decode(new Uint8Array(await res.arrayBuffer()));
}

export const sync = internalAction({
  args: {},
  handler: async (ctx) => {
    try {
      const msg = await fetchFeed(VEHICLES_URL);
      const fetchedAt = Date.now();
      const headerMs = (num(msg.header?.timestamp) ?? 0) * 1000 || fetchedAt;

      const movers: MoverInput[] = [];
      for (const entity of msg.entity ?? []) {
        const vp = entity.vehicle;
        const pos = vp?.position;
        const id = vp?.vehicle?.id;
        if (!vp || !pos || !id) continue;
        if (!inBbox(pos.latitude, pos.longitude, VI_BBOX)) continue;
        const routeId = vp.trip?.routeId ?? undefined;
        const vehLabel = vp.vehicle?.label?.trim() || id;
        movers.push({
          extId: id,
          // route id first — Victoria vehicle labels duplicate the numeric id
          label: routeId ? `${routeId} · ${vehLabel}` : vehLabel,
          lat: pos.latitude,
          lng: pos.longitude,
          heading: pos.bearing ?? undefined,
          // GTFS-RT position.speed is m/s — stored in knots to match the
          // other mover kinds (aircraft gs, vessels SOG)
          speed: pos.speed != null ? Math.round(pos.speed * 1.94384 * 10) / 10 : undefined,
          state: JSON.stringify({
            routeId,
            tripId: vp.trip?.tripId ?? undefined,
            stopId: vp.stopId ?? undefined,
            status: vp.currentStatus != null ? StopStatus[vp.currentStatus] : undefined,
          }),
          at: (num(vp.timestamp) ?? 0) * 1000 || headerMs,
        });
      }

      // Service alerts: same vendor host, 3KB — cheap to ride along on the
      // vehicle cadence. Isolated so an alerts hiccup never drops positions.
      let signals: SignalInput[] = [];
      try {
        const alertsMsg = await fetchFeed(ALERTS_URL);
        signals = (alertsMsg.entity ?? [])
          .filter((e) => e.alert && e.id)
          .map((e) => {
            const a = e.alert!;
            const routes = [
              ...new Set(
                (a.informedEntity ?? []).map((ie) => ie.routeId).filter((r): r is string => !!r),
              ),
            ];
            const header = firstText(a.headerText) ?? 'Service alert';
            const desc = firstText(a.descriptionText);
            const startMs = (num(a.activePeriod?.[0]?.start) ?? 0) * 1000 || undefined;
            const endMs = (num(a.activePeriod?.[0]?.end) ?? 0) * 1000 || undefined;
            return {
              sourceSlug: SLUG,
              kind: 'transit-alert',
              title: routes.length
                ? `${header} — ${routes.slice(0, 4).join(', ')}${routes.length > 4 ? ` +${routes.length - 4}` : ''}`
                : header,
              summary: desc ? desc.replace(/\s+/g, ' ').trim().slice(0, 500) : undefined,
              // GTFS-RT Alert.severityLevel (UNKNOWN_SEVERITY|INFO|WARNING|
              // SEVERE) → watch for WARNING/SEVERE, info otherwise — transit
              // alerts cap at watch on this console (detours, stop closures)
              severity:
                a.severityLevel === SeverityLevel.SEVERE ||
                a.severityLevel === SeverityLevel.WARNING
                  ? ('watch' as const)
                  : ('info' as const),
              // no lat/lng: stop coordinates need the static GTFS bundle
              // (build-time script per ARCHITECTURE §5.8 — later wave)
              startsAt: startMs,
              observedAt: fetchedAt,
              expiresAt: endMs,
              dedupeKey: `${SLUG}:${e.id}`,
              confidence: 1.0,
              provenance: JSON.stringify({
                method: 'poll',
                fetchedAt,
                upstreamId: e.id,
                url: ALERTS_URL,
              }),
              raw: JSON.stringify({
                cause: a.cause != null ? Cause[a.cause] : undefined,
                effect: a.effect != null ? Effect[a.effect] : undefined,
                routes: routes.slice(0, 20),
              }).slice(0, 2000),
            };
          });
      } catch {
        // alerts are best-effort; vehicle positions still ingest
      }

      await ctx.runMutation(internal.feeds.bcTransitIngest.ingest, { movers, signals });
    } catch (e) {
      await ctx.runMutation(internal.feeds.bcTransitIngest.fail, { error: String(e) });
    }
  },
});
