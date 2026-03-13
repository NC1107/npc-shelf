import { create } from 'zustand';
import type { ScanStatus } from '@npc-shelf/shared';

interface ScanState {
  activeScanLibraryId: number | null;
  scanStatus: ScanStatus | null;
  startScan: (libraryId: number) => void;
  updateStatus: (status: ScanStatus | null) => void;
  clearScan: () => void;
}

export const useScanStore = create<ScanState>()((set) => ({
  activeScanLibraryId: null,
  scanStatus: null,
  startScan: (libraryId) => set({ activeScanLibraryId: libraryId, scanStatus: null }),
  updateStatus: (status) => set({ scanStatus: status }),
  clearScan: () => set({ activeScanLibraryId: null, scanStatus: null }),
}));
