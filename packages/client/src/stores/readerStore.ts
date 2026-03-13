import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface ReaderState {
  fontSize: number;
  fontFamily: string;
  theme: 'light' | 'dark' | 'sepia';
  lineHeight: number;
  margins: number;
  setFontSize: (size: number) => void;
  setFontFamily: (family: string) => void;
  setTheme: (theme: ReaderState['theme']) => void;
  setLineHeight: (height: number) => void;
  setMargins: (margins: number) => void;
}

export const useReaderStore = create<ReaderState>()(
  persist(
    (set) => ({
      fontSize: 16,
      fontFamily: 'serif',
      theme: 'light',
      lineHeight: 1.6,
      margins: 40,
      setFontSize: (fontSize) => set({ fontSize }),
      setFontFamily: (fontFamily) => set({ fontFamily }),
      setTheme: (theme) => set({ theme }),
      setLineHeight: (lineHeight) => set({ lineHeight }),
      setMargins: (margins) => set({ margins }),
    }),
    { name: 'npc-shelf-reader' },
  ),
);
