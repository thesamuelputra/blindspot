import * as turf from '@turf/turf';
import type { Doc } from '../../_generated/dataModel';
import type { DerivedCandidate, RuleImpl } from '../types';

// BRIEF §8.1 seed rule: active wildfire + wind vector → projected smoke
// arrival at an Island population center. Watch severity, confidence 0.5,
// explicitly labeled a projection (ARCHITECTURE §7.9: toy advection model,
// straight-line plume centroid, no terrain or dispersion).
//
// Inputs: ctx.signals kind "wildfire" with a point location (bcws-fires point
// rows; perimeter rows carry geojson only and are skipped), and ctx.readings
// metrics "wind_speed" / "wind_dir" from any station feed (uvic-mesh and
// eccc-conditions report km/h, open-meteo kt, ndbc-buoys m/s; the reading's
// unit field drives conversion). wind_dir is meteorological: the direction
// the wind blows FROM, so the plume heads along (wind_dir + 180) % 360.
//
// A candidate fires when a population center sits within ±halfAngleDeg of the
// downwind bearing and closer than maxDistanceKm. ETA = distance / wind speed.
//
// Params (rules table JSON): maxDistanceKm (default 80), halfAngleDeg
// (default 30), windSearchKm (default 50, station-to-fire radius),
// minWindKmh (default 3, below which advection is meaningless).

const POPULATION_CENTERS = [
  { name: 'Victoria', lat: 48.43, lng: -123.37 },
  { name: 'Nanaimo', lat: 49.17, lng: -123.94 },
  { name: 'Comox', lat: 49.67, lng: -124.93 },
  { name: 'Port Alberni', lat: 49.23, lng: -124.81 },
  { name: 'Campbell River', lat: 50.02, lng: -125.24 },
] as const;

const RULE_CONFIDENCE = 0.5; // modeled projection (ARCHITECTURE §4)

function toKmh(value: number, unit: string): number {
  const u = unit.toLowerCase();
  if (u === 'kt' || u === 'kn' || u.startsWith('knot')) return value * 1.852;
  if (u === 'm/s' || u === 'mps') return value * 3.6;
  return value; // km/h, and unknown units treated as km/h
}

function angleDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

interface WindStation {
  stationId: string;
  lat: number;
  lng: number;
  speedKmh?: number;
  dirDeg?: number;
}

// Latest wind_speed + wind_dir per station (readings arrive newest-first from
// loadContext, but we keep the max-at reading per metric to be order-safe).
function windStations(readings: Doc<'readings'>[]): WindStation[] {
  const latest = new Map<string, { speed?: Doc<'readings'>; dir?: Doc<'readings'> }>();
  for (const r of readings) {
    if ((r.metric !== 'wind_speed' && r.metric !== 'wind_dir') || r.lat == null || r.lng == null)
      continue;
    const slot = latest.get(r.stationId) ?? {};
    if (r.metric === 'wind_speed' && (!slot.speed || r.at > slot.speed.at)) slot.speed = r;
    if (r.metric === 'wind_dir' && (!slot.dir || r.at > slot.dir.at)) slot.dir = r;
    latest.set(r.stationId, slot);
  }
  const out: WindStation[] = [];
  for (const [stationId, slot] of latest) {
    const anchor = slot.speed ?? slot.dir;
    if (!anchor || anchor.lat == null || anchor.lng == null) continue;
    out.push({
      stationId,
      lat: anchor.lat,
      lng: anchor.lng,
      speedKmh: slot.speed ? toKmh(slot.speed.value, slot.speed.unit) : undefined,
      dirDeg: slot.dir?.value,
    });
  }
  return out;
}

export const smokeEta: RuleImpl = (ctx, params) => {
  const maxDistanceKm = typeof params.maxDistanceKm === 'number' ? params.maxDistanceKm : 80;
  const halfAngleDeg = typeof params.halfAngleDeg === 'number' ? params.halfAngleDeg : 30;
  const windSearchKm = typeof params.windSearchKm === 'number' ? params.windSearchKm : 50;
  const minWindKmh = typeof params.minWindKmh === 'number' ? params.minWindKmh : 3;

  const stations = windStations(ctx.readings).filter(
    (s) => s.speedKmh != null && s.dirDeg != null,
  );
  if (stations.length === 0) return [];

  const out: DerivedCandidate[] = [];

  for (const fire of ctx.signals) {
    if (fire.kind !== 'wildfire' || fire.lat == null || fire.lng == null) continue;
    // Skip fires reported as out (bcws-fires raw: {hectares, status, ...}).
    try {
      const raw = fire.raw ? (JSON.parse(fire.raw) as { status?: string }) : {};
      if (typeof raw.status === 'string' && raw.status.trim().toLowerCase() === 'out') continue;
    } catch {
      /* unreadable raw → treat as active */
    }

    const firePt = turf.point([fire.lng, fire.lat]);

    // Nearest wind station within windSearchKm of the fire.
    let nearest: { station: WindStation; km: number } | undefined;
    for (const s of stations) {
      const km = turf.distance(firePt, turf.point([s.lng, s.lat]), { units: 'kilometers' });
      if (km > windSearchKm) continue;
      if (!nearest || km < nearest.km) nearest = { station: s, km };
    }
    if (!nearest) continue;

    const speedKmh = nearest.station.speedKmh as number;
    const dirDeg = nearest.station.dirDeg as number;
    if (speedKmh < minWindKmh) continue;
    const downwind = (dirDeg + 180) % 360;

    for (const city of POPULATION_CENTERS) {
      const cityPt = turf.point([city.lng, city.lat]);
      const distKm = turf.distance(firePt, cityPt, { units: 'kilometers' });
      if (distKm >= maxDistanceKm) continue;
      const bearing = (turf.bearing(firePt, cityPt) + 360) % 360;
      if (angleDiff(bearing, downwind) > halfAngleDeg) continue;

      const etaHours = distKm / speedKmh;
      const etaMs = ctx.now + etaHours * 3600_000;
      const etaHHMM = new Date(etaMs).toISOString().slice(11, 16);
      const citySlug = city.name.toLowerCase().replace(/\s+/g, '-');

      out.push({
        rule: 'smoke-eta',
        title: `Smoke may reach ${city.name} ~${etaHHMM} UTC`,
        summary:
          `Projection: smoke from "${fire.title}" may reach ${city.name} in about ` +
          `${etaHours.toFixed(1)} h (~${etaHHMM} UTC). Wind ${Math.round(speedKmh)} km/h ` +
          `from ${Math.round(dirDeg)} deg at ${nearest.station.stationId}, ` +
          `${Math.round(nearest.km)} km from the fire.`,
        severity: 'watch',
        lat: fire.lat,
        lng: fire.lng,
        confidence: RULE_CONFIDENCE,
        contributingIds: [String(fire._id)],
        rationale:
          `This is a projection from a straight-line wind advection model, not a smoke ` +
          `observation. ${city.name} lies ${Math.round(distKm)} km from the fire at bearing ` +
          `${Math.round(bearing)} deg, within ${halfAngleDeg} deg of the downwind direction ` +
          `${Math.round(downwind)} deg. At ${Math.round(speedKmh)} km/h the plume centroid ` +
          `would arrive in about ${etaHours.toFixed(1)} hours. Terrain, dispersion and wind ` +
          `shifts are not modeled. Confidence is capped at ${RULE_CONFIDENCE} for projections.`,
        dedupeKey: `derived:smoke-eta:${String(fire._id)}:${citySlug}`,
      });
    }
  }

  return out;
};
