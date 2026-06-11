import { create } from 'zustand';

interface UiState {
  // live map reticle (hover position), shown in the top bar readout
  reticle: { lat: number; lng: number } | null;
  setReticle: (r: UiState['reticle']) => void;
  // layer toggles, keyed by LayerDef.id; absent = layer default
  layersOn: Record<string, boolean>;
  toggleLayer: (id: string, defaultOn: boolean) => void;
}

export const useUi = create<UiState>((set) => ({
  reticle: null,
  setReticle: (reticle) => set({ reticle }),
  layersOn: {},
  toggleLayer: (id, defaultOn) =>
    set((s) => ({ layersOn: { ...s.layersOn, [id]: !(s.layersOn[id] ?? defaultOn) } })),
}));
