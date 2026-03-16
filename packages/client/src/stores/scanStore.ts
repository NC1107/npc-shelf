import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ScanStatus } from '@npc-shelf/shared';

interface ScanState {
  activeScanLibraryId: number | null;
  scanStatus: ScanStatus | null;
  startScan: (libraryId: number) => void;
  updateStatus: (status: ScanStatus | null) => void;
  clearScan: () => void;
}

export const useScanStore = create<ScanState>()(
  persist(
    (set) => ({
      activeScanLibraryId: null,
      scanStatus: null,
      startScan: (libraryId) => set({ activeScanLibraryId: libraryId, scanStatus: null }),
      updateStatus: (status) => set({ scanStatus: status }),
      clearScan: () => set({ activeScanLibraryId: null, scanStatus: null }),
    }),
    {
      name: 'npc-shelf-scan',
      partialize: (state) => ({
        activeScanLibraryId: state.activeScanLibraryId,
      }),
    },
  ),
);
