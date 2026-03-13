import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AudioState {
  bookId: number | null;
  bookTitle: string;
  bookAuthor: string;
  coverUrl: string | null;
  currentTrackIndex: number;
  positionSeconds: number;
  totalDurationSeconds: number;
  playbackRate: number;
  volume: number;
  isPlaying: boolean;
  isMinimized: boolean;
  sleepTimerMinutes: number | null;

  setBook: (book: {
    bookId: number;
    title: string;
    author: string;
    coverUrl: string | null;
    totalDurationSeconds: number;
  }) => void;
  setTrack: (trackIndex: number) => void;
  setPosition: (seconds: number) => void;
  setPlaybackRate: (rate: number) => void;
  setVolume: (volume: number) => void;
  setPlaying: (playing: boolean) => void;
  setMinimized: (minimized: boolean) => void;
  setSleepTimer: (minutes: number | null) => void;
  stop: () => void;
}

export const useAudioStore = create<AudioState>()(
  persist(
    (set) => ({
      bookId: null,
      bookTitle: '',
      bookAuthor: '',
      coverUrl: null,
      currentTrackIndex: 0,
      positionSeconds: 0,
      totalDurationSeconds: 0,
      playbackRate: 1,
      volume: 1,
      isPlaying: false,
      isMinimized: true,
      sleepTimerMinutes: null,

      setBook: (book) =>
        set({
          bookId: book.bookId,
          bookTitle: book.title,
          bookAuthor: book.author,
          coverUrl: book.coverUrl,
          totalDurationSeconds: book.totalDurationSeconds,
          currentTrackIndex: 0,
          positionSeconds: 0,
          isPlaying: false,
        }),
      setTrack: (trackIndex) => set({ currentTrackIndex: trackIndex, positionSeconds: 0 }),
      setPosition: (seconds) => set({ positionSeconds: seconds }),
      setPlaybackRate: (rate) => set({ playbackRate: rate }),
      setVolume: (volume) => set({ volume }),
      setPlaying: (playing) => set({ isPlaying: playing }),
      setMinimized: (minimized) => set({ isMinimized: minimized }),
      setSleepTimer: (minutes) => set({ sleepTimerMinutes: minutes }),
      stop: () =>
        set({
          bookId: null,
          bookTitle: '',
          bookAuthor: '',
          coverUrl: null,
          currentTrackIndex: 0,
          positionSeconds: 0,
          totalDurationSeconds: 0,
          isPlaying: false,
        }),
    }),
    {
      name: 'npc-shelf-audio',
      partialize: (state) => ({
        bookId: state.bookId,
        bookTitle: state.bookTitle,
        bookAuthor: state.bookAuthor,
        coverUrl: state.coverUrl,
        currentTrackIndex: state.currentTrackIndex,
        positionSeconds: state.positionSeconds,
        totalDurationSeconds: state.totalDurationSeconds,
        playbackRate: state.playbackRate,
        volume: state.volume,
      }),
    },
  ),
);
