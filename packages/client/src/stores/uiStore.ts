import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type Theme = 'light' | 'dark' | 'system';
type LibraryView = 'grid' | 'list';

interface LibraryFilters {
  librarySearch: string;
  libraryPage: number;
  librarySortBy: string;
  librarySortOrder: 'asc' | 'desc';
  libraryFormat: string;
  libraryAuthorId: string;
  librarySeriesId: string;
}

interface UiState extends LibraryFilters {
  sidebarOpen: boolean;
  theme: Theme;
  libraryView: LibraryView;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  setTheme: (theme: Theme) => void;
  setLibraryView: (view: LibraryView) => void;
  setLibraryFilters: (filters: Partial<LibraryFilters>) => void;
  clearLibraryFilters: () => void;
}

const defaultFilters: LibraryFilters = {
  librarySearch: '',
  libraryPage: 1,
  librarySortBy: 'title',
  librarySortOrder: 'asc',
  libraryFormat: '',
  libraryAuthorId: '',
  librarySeriesId: '',
};

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarOpen: true,
      theme: 'dark',
      libraryView: 'grid',
      ...defaultFilters,
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
      setLibraryFilters: (filters) => set(filters),
      clearLibraryFilters: () => set(defaultFilters),
    }),
    {
      name: 'npc-shelf-ui',
      partialize: (state) => ({
        theme: state.theme,
        libraryView: state.libraryView,
        sidebarOpen: state.sidebarOpen,
        librarySearch: state.librarySearch,
        libraryPage: state.libraryPage,
        librarySortBy: state.librarySortBy,
        librarySortOrder: state.librarySortOrder,
        libraryFormat: state.libraryFormat,
        libraryAuthorId: state.libraryAuthorId,
        librarySeriesId: state.librarySeriesId,
      }),
    },
  ),
);
