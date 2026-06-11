import { PathLayer } from '@deck.gl/layers';
import { PathStyleExtension, type PathStyleExtensionProps } from '@deck.gl/extensions';
import type { Layer } from '@deck.gl/core';

// Trail rendering (Samuel's contract): smooth, not jaggedy — solid line for
// historical movement, dashed line for the dead-reckoned future path.

export interface TrailPoint {
  lat: number;
  lng: number;
  at?: number;
}

// Catmull-Rom through the raw fixes, resampled so sparse displacement-gated
// track points render as a continuous curve instead of elbow segments.
const SAMPLES_PER_SEG = 8;

function smoothPath(points: TrailPoint[]): Array<[number, number]> {
  // drop consecutive duplicates (zero-length tangents break the spline)
  const pts: Array<[number, number]> = [];
  for (const p of points) {
    const last = pts[pts.length - 1];
    if (!last || last[0] !== p.lng || last[1] !== p.lat) pts.push([p.lng, p.lat]);
  }
  if (pts.length < 3) return pts;

  const out: Array<[number, number]> = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let s = 1; s <= SAMPLES_PER_SEG; s++) {
      const t = s / SAMPLES_PER_SEG;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push([
        0.5 *
          (2 * p1[0] +
            (-p0[0] + p2[0]) * t +
            (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
            (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 *
          (2 * p1[1] +
            (-p0[1] + p2[1]) * t +
            (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
            (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  return out;
}

// Solid history trail: smoothed curve, alpha ramping oldest→newest so the
// direction of travel reads instantly.
export function buildHistoryTrail(
  id: string,
  points: TrailPoint[],
  color: [number, number, number],
): Layer[] {
  if (points.length < 2) return [];
  const path = smoothPath(points);
  const segs = [];
  for (let i = 1; i < path.length; i++) {
    segs.push({
      path: [path[i - 1], path[i]] as [number, number][],
      alpha: 50 + Math.round(185 * (i / path.length)),
    });
  }
  return [
    new PathLayer<{ path: [number, number][]; alpha: number }>({
      id,
      data: segs,
      getPath: (d) => d.path,
      getColor: (d) => [color[0], color[1], color[2], d.alpha],
      getWidth: 2,
      widthUnits: 'pixels',
      capRounded: true,
      jointRounded: true,
    }),
  ];
}

// Dashed dead-reckoned future path: straight-ray projection along the current
// heading at the current speed. Presentation of a projection, labeled by its
// dashes — movers turn, rays do not.
const KT_TO_MPS = 0.514444;
const M_PER_DEG_LAT = 111_320;

const FUTURE_MINUTES: Record<string, number> = {
  aircraft: 8,
  vessel: 25,
  ferry: 25,
  bus: 3,
  balloon: 12,
};

export function buildFutureTrail(
  id: string,
  kind: string,
  from: { lat: number; lng: number; heading?: number; speed?: number },
  color: [number, number, number],
): Layer[] {
  const { heading, speed } = from;
  if (heading === undefined || speed === undefined || speed < 2) return [];
  const minutes = FUTURE_MINUTES[kind] ?? 10;
  const rad = (heading * Math.PI) / 180;
  const path: Array<[number, number]> = [[from.lng, from.lat]];
  const steps = 6;
  for (let s = 1; s <= steps; s++) {
    const dist = speed * KT_TO_MPS * ((minutes * 60 * s) / steps);
    path.push([
      from.lng + (dist * Math.sin(rad)) / (M_PER_DEG_LAT * Math.cos((from.lat * Math.PI) / 180)),
      from.lat + (dist * Math.cos(rad)) / M_PER_DEG_LAT,
    ]);
  }
  return [
    new PathLayer<{ path: Array<[number, number]> }, PathStyleExtensionProps>({
      id,
      data: [{ path }],
      getPath: (d) => d.path,
      getColor: [color[0], color[1], color[2], 170],
      getWidth: 1.8,
      widthUnits: 'pixels',
      capRounded: true,
      extensions: [new PathStyleExtension({ dash: true })],
      getDashArray: [7, 5],
      dashJustified: false,
    }),
  ];
}
