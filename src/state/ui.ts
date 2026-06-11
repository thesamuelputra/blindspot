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
}));
