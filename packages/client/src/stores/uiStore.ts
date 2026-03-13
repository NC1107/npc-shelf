import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type Theme = 'light' | 'dark' | 'system';
type LibraryView = 'grid' | 'list';

interface UiState {
  sidebarOpen: boolean;
  theme: Theme;
  libraryView: LibraryView;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  setTheme: (theme: Theme) => void;
  setLibraryView: (view: LibraryView) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarOpen: true,
      theme: 'dark',
      libraryView: 'grid',
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      setTheme: (theme) => {
        const root = document.documentElement;
        if (theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
          root.classList.add('dark');
        } else {
          root.classList.remove('dark');
        }
        set({ theme });
      },
      setLibraryView: (libraryView) => set({ libraryView }),
    }),
    {
      name: 'npc-shelf-ui',
      partialize: (state) => ({
        theme: state.theme,
        libraryView: state.libraryView,
        sidebarOpen: state.sidebarOpen,
      }),
    },
  ),
);
