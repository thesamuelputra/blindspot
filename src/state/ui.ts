import { create } from 'zustand';

// Inspector targets (ARCHITECTURE §10 interaction contract):
// click = the thing itself — mover details + path, camera live feed, signal facts.
export type InspectTarget =
  | { type: 'mover'; kind: string; extId: string; label: string }
  | { type: 'camera'; camera: CameraDoc }
  | { type: 'signal'; data: Record<string, unknown> };

export interface CameraDoc {
  slug: string;
  name: string;
  lat: number;
  lng: number;
  kind: 'snapshot' | 'hls' | 'iframe' | 'audio';
  mediaUrl: string;
  refreshSec?: number;
  attribution: string;
}

interface UiState {
  // live map reticle (hover position), shown in the top bar readout
  reticle: { lat: number; lng: number } | null;
  setReticle: (r: UiState['reticle']) => void;
  // layer toggles, keyed by LayerDef.id; absent = layer default
  layersOn: Record<string, boolean>;
  toggleLayer: (id: string, defaultOn: boolean) => void;
  // hovered mover → fading trail on the map
  hoverMover: { kind: string; extId: string } | null;
  setHoverMover: (h: UiState['hoverMover']) => void;
  // inspector panel
  inspect: InspectTarget | null;
  setInspect: (t: InspectTarget | null) => void;
  // time as the second axis (ARCHITECTURE §8): live = now-queries;
  // replay = client scrubs a fetched window, t is the playhead (ms epoch)
  time: { mode: 'live' | 'replay'; t: number; windowH: 1 | 6 | 24 | 48 };
  setTimeMode: (mode: 'live' | 'replay') => void;
  setPlayhead: (t: number) => void;
  setWindowH: (h: 1 | 6 | 24 | 48) => void;
  // one-shot fly-to requests (analyst highlights, ⌘K, incident jump);
  // MapShell consumes and clears
  flyTo: { lat: number; lng: number; zoom?: number } | null;
  requestFlyTo: (f: UiState['flyTo']) => void;
  // current map zoom (MapShell writes on zoomend; label density gates on it)
  mapZoom: number;
  setMapZoom: (z: number) => void;
  // planned flight path of the inspected aircraft (origin→dest airports);
  // the enrichment panel sets it, MapView draws it, cleared when inspect changes
  flightRoute: FlightRoute | null;
  setFlightRoute: (r: FlightRoute | null) => void;
}

export interface FlightRoute {
  originLat: number;
  originLng: number;
  originName?: string;
  destLat: number;
  destLng: number;
  destName?: string;
  curLat: number;
  curLng: number;
}

export const useUi = create<UiState>((set) => ({
  reticle: null,
  setReticle: (reticle) => set({ reticle }),
  layersOn: {},
  toggleLayer: (id, defaultOn) =>
    set((s) => ({ layersOn: { ...s.layersOn, [id]: !(s.layersOn[id] ?? defaultOn) } })),
  hoverMover: null,
  setHoverMover: (hoverMover) =>
    set((s) =>
      s.hoverMover?.extId === hoverMover?.extId && s.hoverMover?.kind === hoverMover?.kind
        ? s
        : { hoverMover },
    ),
  inspect: null,
  setInspect: (inspect) => set({ inspect }),
  time: { mode: 'live', t: 0, windowH: 6 },
  setTimeMode: (mode) =>
    set((s) => ({ time: { ...s.time, mode, t: mode === 'replay' ? Date.now() : 0 } })),
  setPlayhead: (t) => set((s) => ({ time: { ...s.time, t } })),
  setWindowH: (windowH) => set((s) => ({ time: { ...s.time, windowH } })),
  flyTo: null,
  requestFlyTo: (flyTo) => set({ flyTo }),
  mapZoom: 7,
  setMapZoom: (mapZoom) => set({ mapZoom }),
  flightRoute: null,
  setFlightRoute: (flightRoute) => set({ flightRoute }),
}));
