import { create } from 'zustand';

interface UiState {
  // live map reticle (hover position), shown in the top bar readout
  reticle: { lat: number; lng: number } | null;
  setReticle: (r: UiState['reticle']) => void;
}

export const useUi = create<UiState>((set) => ({
  reticle: null,
  setReticle: (reticle) => set({ reticle }),
}));
