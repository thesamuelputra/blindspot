import type { Layer } from '@deck.gl/core';
import { TripsLayer } from '@deck.gl/geo-layers';
import { ScatterplotLayer } from '@deck.gl/layers';
import { SEVERITY_RGBA } from '@/layers/types';

// Replay deck layers (ARCHITECTURE §8): TripsLayer trails per mover kind plus
// a severity-colored scatter of signals up to the playhead. Pure factory —
// MapView feeds it the two replay queries and the current playhead.

export interface ReplayTrack {
  kind: string;
  extId: string;
  label: string;
  points: Array<{ lat: number; lng: number; at: number }>;
}

export interface ReplaySignal {
  kind: string;
  title: string;
  severity: string;
  lat: number;
  lng: number;
  observedAt: number;
  [key: string]: unknown;
}

export interface ReplayData {
  tracks: ReplayTrack[];
  signals: ReplaySignal[];
  fromMs: number; // window start — TripsLayer timestamps rebase to this
}

// Kind colors match the live mover layers: aircraft cyan, vessel light,
// ferry violet, bus green, balloon amber.
const KIND_RGB: Record<string, [number, number, number]> = {
  aircraft: [56, 189, 248],
  vessel: [230, 234, 240],
  ferry: [167, 139, 250],
  bus: [52, 211, 153],
  balloon: [245, 158, 11],
};
const FALLBACK_RGB: [number, number, number] = [154, 164, 178];

const TRAIL_LENGTH_S = 600; // ~10 min of motion visible behind the head
const RECENT_MS = 15 * 60_000; // signals newer than this render larger

export function buildReplayLayers(data: ReplayData, playheadMs: number): Layer[] {
  const { tracks, signals, fromMs } = data;
  // Rebase to seconds since window start — epoch ms in float32 quantizes at
  // ~2 min and freezes trails (ARCHITECTURE §10 convention).
  const currentTime = (playheadMs - fromMs) / 1000;
  const layers: Layer[] = [];

  const byKind = new Map<string, ReplayTrack[]>();
  for (const t of tracks) {
    if (t.points.length < 2) continue;
    const bucket = byKind.get(t.kind);
    if (bucket) bucket.push(t);
    else byKind.set(t.kind, [t]);
  }

  for (const [kind, list] of byKind) {
    layers.push(
      new TripsLayer<ReplayTrack>({
        id: `replay-trips-${kind}`,
        data: list,
        getPath: (d) => d.points.map((p) => [p.lng, p.lat] as [number, number]),
        getTimestamps: (d) => d.points.map((p) => (p.at - fromMs) / 1000),
        getColor: KIND_RGB[kind] ?? FALLBACK_RGB,
        currentTime,
        trailLength: TRAIL_LENGTH_S,
        fadeTrail: true,
        widthMinPixels: 2,
        capRounded: true,
        jointRounded: true,
        opacity: 0.9,
      }),
    );
  }

  const visible = signals.filter((s) => s.observedAt <= playheadMs);
  layers.push(
    new ScatterplotLayer<ReplaySignal>({
      id: 'replay-signals',
      data: visible,
      getPosition: (d) => [d.lng, d.lat],
      getFillColor: (d) => SEVERITY_RGBA[d.severity] ?? SEVERITY_RGBA.info,
      getRadius: (d) => (playheadMs - d.observedAt < RECENT_MS ? 7 : 4),
      radiusUnits: 'pixels',
      stroked: false,
      pickable: true,
    }),
  );

  return layers;
}
