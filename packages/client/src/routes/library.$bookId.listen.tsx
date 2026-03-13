import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from '@tanstack/react-router';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  ArrowLeft, Play, Pause, SkipBack, SkipForward,
  Volume2, VolumeX, Timer, ListMusic, Gauge,
} from 'lucide-react';
import { Button } from '../components/ui/button';
import { api } from '../lib/api';
import { AudioEngine } from '../lib/AudioEngine';
import { useAudioStore } from '../stores/audioStore';
import type { BookDetail, AudioProgress, AudioTrack, AudioChapter } from '@npc-shelf/shared';

function formatTime(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
const SLEEP_OPTIONS = [null, 5, 10, 15, 30, 45, 60, 90];

export function ListenPage() {
  const { bookId } = useParams({ strict: false }) as { bookId: string };
  const [showChapters, setShowChapters] = useState(false);
  const [showSpeed, setShowSpeed] = useState(false);
  const [showSleep, setShowSleep] = useState(false);

  const store = useAudioStore();
  const sleepTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: book } = useQuery({
    queryKey: ['book', bookId],
    queryFn: () => api.get<BookDetail>(`/books/${bookId}`),
    enabled: !!bookId,
  });

  const { data: tracks } = useQuery({
    queryKey: ['audio-tracks', bookId],
    queryFn: () => api.get<AudioTrack[]>(`/audiobooks/${bookId}/tracks`),
    enabled: !!bookId,
  });

  const { data: chapters } = useQuery({
    queryKey: ['audio-chapters', bookId],
    queryFn: () => api.get<AudioChapter[]>(`/audiobooks/${bookId}/chapters`),
    enabled: !!bookId,
  });

  const { data: savedProgress } = useQuery({
    queryKey: ['audio-progress', bookId],
    queryFn: () => api.get<AudioProgress | null>(`/audiobooks/${bookId}/progress`),
    enabled: !!bookId,
  });

  const saveProgress = useMutation({
    mutationFn: (data: Partial<AudioProgress>) =>
      api.put(`/audiobooks/${bookId}/progress`, data),
  });

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Initialize audio when book data is ready
  useEffect(() => {
    if (!book || !tracks || tracks.length === 0) return;

    const numericBookId = parseInt(bookId);
    const isCurrentBook = store.bookId === numericBookId;

    // If this book is already loaded, just continue
    if (isCurrentBook) return;

    const totalDuration = tracks.reduce((sum, t) => sum + t.durationSeconds, 0);
    const authorName = book.authors?.[0]?.author.name || '';
    const coverUrl = book.coverPath ? `/api/books/${book.id}/cover/medium` : null;

    store.setBook({
      bookId: numericBookId,
      title: book.title,
      author: authorName,
      coverUrl,
      totalDurationSeconds: totalDuration,
    });

    // Resume from saved progress
    const trackIdx = savedProgress?.currentTrackIndex || 0;
    const position = savedProgress?.positionSeconds || 0;

    store.setTrack(trackIdx);
    loadTrack(numericBookId, trackIdx, position);
  }, [book, tracks, savedProgress]);

  function loadTrack(bId: number, trackIndex: number, seekTo?: number) {
    const url = `/api/audiobooks/${bId}/stream/${trackIndex}`;
    AudioEngine.load(url);
    if (seekTo && seekTo > 0) {
      // Wait for loadedmetadata to seek
      const onLoaded = () => {
        AudioEngine.seek(seekTo);
      };
      // Use a small delay to allow load
      setTimeout(onLoaded, 300);
    }
  }

  // Time update handler
  useEffect(() => {
    AudioEngine.onTimeUpdate((time) => {
      store.setPosition(time);

      // Debounced save
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        const totalElapsed = calculateTotalElapsed(store.currentTrackIndex, time);
        saveProgress.mutate({
          currentTrackIndex: store.currentTrackIndex,
          positionSeconds: time,
          totalElapsedSeconds: totalElapsed,
          totalDurationSeconds: store.totalDurationSeconds,
          playbackRate: store.playbackRate,
          isFinished: false,
        });
      }, 5000);
    });

    AudioEngine.onEnded(() => {
      // Auto-advance to next track
      if (tracks && store.currentTrackIndex < tracks.length - 1) {
        const nextTrack = store.currentTrackIndex + 1;
        store.setTrack(nextTrack);
        loadTrack(parseInt(bookId), nextTrack);
        AudioEngine.play();
      } else {
        store.setPlaying(false);
        // Mark as finished
        saveProgress.mutate({
          currentTrackIndex: store.currentTrackIndex,
          positionSeconds: 0,
          totalElapsedSeconds: store.totalDurationSeconds,
          totalDurationSeconds: store.totalDurationSeconds,
          playbackRate: store.playbackRate,
          isFinished: true,
        });
      }
    });
  }, [tracks]);

  // Apply playback rate
  useEffect(() => {
    AudioEngine.playbackRate = store.playbackRate;
  }, [store.playbackRate]);

  // Apply volume
  useEffect(() => {
    AudioEngine.volume = store.volume;
  }, [store.volume]);

  // Sleep timer
  useEffect(() => {
    if (sleepTimerRef.current) {
      clearTimeout(sleepTimerRef.current);
      sleepTimerRef.current = null;
    }
    if (store.sleepTimerMinutes) {
      sleepTimerRef.current = setTimeout(() => {
        AudioEngine.pause();
        store.setPlaying(false);
        store.setSleepTimer(null);
      }, store.sleepTimerMinutes * 60 * 1000);
    }
    return () => {
      if (sleepTimerRef.current) clearTimeout(sleepTimerRef.current);
    };
  }, [store.sleepTimerMinutes]);

  // Media Session API
  useEffect(() => {
    if (!book) return;
    AudioEngine.setupMediaSession({
      title: book.title,
      artist: book.authors?.[0]?.author.name || '',
      album: book.title,
      coverUrl: book.coverPath ? `/api/books/${book.id}/cover/medium` : undefined,
    });

    if ('mediaSession' in navigator) {
      navigator.mediaSession.setActionHandler('play', () => {
        AudioEngine.play();
        store.setPlaying(true);
      });
      navigator.mediaSession.setActionHandler('pause', () => {
        AudioEngine.pause();
        store.setPlaying(false);
      });
      navigator.mediaSession.setActionHandler('seekbackward', () => {
        AudioEngine.seek(Math.max(0, AudioEngine.currentTime - 30));
      });
      navigator.mediaSession.setActionHandler('seekforward', () => {
        AudioEngine.seek(AudioEngine.currentTime + 30);
      });
    }
  }, [book]);

  function calculateTotalElapsed(trackIndex: number, posInTrack: number): number {
    if (!tracks) return posInTrack;
    let elapsed = 0;
    for (let i = 0; i < trackIndex && i < tracks.length; i++) {
      elapsed += tracks[i]!.durationSeconds;
    }
    return elapsed + posInTrack;
  }

  const togglePlay = () => {
    if (store.isPlaying) {
      AudioEngine.pause();
      store.setPlaying(false);
    } else {
      AudioEngine.play();
      store.setPlaying(true);
    }
  };

  const skipBack = () => AudioEngine.seek(Math.max(0, AudioEngine.currentTime - 30));
  const skipForward = () => AudioEngine.seek(AudioEngine.currentTime + 30);

  const seekToChapter = (chapter: AudioChapter) => {
    if (chapter.trackIndex !== store.currentTrackIndex) {
      store.setTrack(chapter.trackIndex);
      loadTrack(parseInt(bookId), chapter.trackIndex, chapter.startTime);
    } else {
      AudioEngine.seek(chapter.startTime);
    }
    setShowChapters(false);
  };

  const switchTrack = (trackIndex: number) => {
    store.setTrack(trackIndex);
    loadTrack(parseInt(bookId), trackIndex);
    if (store.isPlaying) {
      setTimeout(() => AudioEngine.play(), 100);
    }
  };

  const trackDuration = tracks?.[store.currentTrackIndex]?.durationSeconds || 0;
  const progressPercent = trackDuration > 0 ? (store.positionSeconds / trackDuration) * 100 : 0;
  const totalElapsed = calculateTotalElapsed(store.currentTrackIndex, store.positionSeconds);
  const overallProgress = store.totalDurationSeconds > 0 ? (totalElapsed / store.totalDurationSeconds) * 100 : 0;

  return (
    <div className="mx-auto max-w-lg space-y-6 pb-8">
      {/* Back link */}
      <Link
        to="/library/$bookId"
        params={{ bookId }}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Book
      </Link>

      {/* Cover */}
      <div className="flex justify-center">
        <div className="h-64 w-64 overflow-hidden rounded-xl bg-muted shadow-xl">
          {book?.coverPath ? (
            <img
              src={`/api/books/${book.id}/cover/medium`}
              alt={book.title}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <Volume2 className="h-16 w-16" />
            </div>
          )}
        </div>
      </div>

      {/* Title & Author */}
      <div className="text-center">
        <h1 className="text-xl font-bold">{book?.title}</h1>
        <p className="text-sm text-muted-foreground">
          {book?.authors?.map((a) => a.author.name).join(', ')}
        </p>
        {tracks && tracks.length > 1 && (
          <p className="mt-1 text-xs text-muted-foreground">
            Track {store.currentTrackIndex + 1} of {tracks.length}
            {tracks[store.currentTrackIndex]?.title && ` — ${tracks[store.currentTrackIndex]!.title}`}
          </p>
        )}
      </div>

      {/* Progress bar */}
      <div className="space-y-1">
        <div
          className="group relative h-2 cursor-pointer rounded-full bg-muted"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const pct = (e.clientX - rect.left) / rect.width;
            AudioEngine.seek(pct * trackDuration);
          }}
        >
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{formatTime(store.positionSeconds)}</span>
          <span>-{formatTime(trackDuration - store.positionSeconds)}</span>
        </div>
      </div>

      {/* Main controls */}
      <div className="flex items-center justify-center gap-4">
        <Button variant="ghost" size="icon" className="h-12 w-12" onClick={skipBack}>
          <SkipBack className="h-5 w-5" />
        </Button>
        <Button
          size="icon"
          className="h-16 w-16 rounded-full"
          onClick={togglePlay}
        >
          {store.isPlaying ? <Pause className="h-7 w-7" /> : <Play className="h-7 w-7 ml-1" />}
        </Button>
        <Button variant="ghost" size="icon" className="h-12 w-12" onClick={skipForward}>
          <SkipForward className="h-5 w-5" />
        </Button>
      </div>

      {/* Overall progress */}
      <div className="space-y-1">
        <div className="h-1 rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary/50 transition-all"
            style={{ width: `${overallProgress}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{formatTime(totalElapsed)}</span>
          <span>{formatTime(store.totalDurationSeconds)}</span>
        </div>
      </div>

      {/* Secondary controls */}
      <div className="flex items-center justify-center gap-2">
        {/* Speed */}
        <div className="relative">
          <Button
            variant={showSpeed ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => { setShowSpeed(!showSpeed); setShowChapters(false); setShowSleep(false); }}
          >
            <Gauge className="h-3.5 w-3.5 mr-1" />
            {store.playbackRate}x
          </Button>
          {showSpeed && (
            <div className="absolute bottom-full left-0 z-10 mb-2 rounded-lg border bg-card p-2 shadow-lg">
              <div className="grid grid-cols-3 gap-1">
                {PLAYBACK_RATES.map((rate) => (
                  <Button
                    key={rate}
                    variant={store.playbackRate === rate ? 'default' : 'ghost'}
                    size="sm"
                    className="text-xs"
                    onClick={() => { store.setPlaybackRate(rate); setShowSpeed(false); }}
                  >
                    {rate}x
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Volume */}
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => store.setVolume(store.volume > 0 ? 0 : 1)}
          >
            {store.volume === 0 ? (
              <VolumeX className="h-3.5 w-3.5" />
            ) : (
              <Volume2 className="h-3.5 w-3.5" />
            )}
          </Button>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={store.volume}
            onChange={(e) => store.setVolume(parseFloat(e.target.value))}
            className="w-20 accent-primary"
          />
        </div>

        {/* Sleep timer */}
        <div className="relative">
          <Button
            variant={store.sleepTimerMinutes ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => { setShowSleep(!showSleep); setShowChapters(false); setShowSpeed(false); }}
          >
            <Timer className="h-3.5 w-3.5 mr-1" />
            {store.sleepTimerMinutes ? `${store.sleepTimerMinutes}m` : 'Sleep'}
          </Button>
          {showSleep && (
            <div className="absolute bottom-full right-0 z-10 mb-2 rounded-lg border bg-card p-2 shadow-lg">
              <div className="grid grid-cols-2 gap-1">
                {SLEEP_OPTIONS.map((mins) => (
                  <Button
                    key={mins ?? 'off'}
                    variant={store.sleepTimerMinutes === mins ? 'default' : 'ghost'}
                    size="sm"
                    className="text-xs"
                    onClick={() => { store.setSleepTimer(mins); setShowSleep(false); }}
                  >
                    {mins === null ? 'Off' : `${mins}m`}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Chapters toggle */}
        <Button
          variant={showChapters ? 'secondary' : 'outline'}
          size="sm"
          onClick={() => { setShowChapters(!showChapters); setShowSpeed(false); setShowSleep(false); }}
        >
          <ListMusic className="h-3.5 w-3.5 mr-1" />
          Chapters
        </Button>
      </div>

      {/* Chapter / Track list */}
      {showChapters && (
        <div className="rounded-lg border bg-card">
          {chapters && chapters.length > 0 ? (
            <div className="max-h-64 overflow-y-auto">
              {chapters.map((ch, i) => (
                <button
                  key={ch.id || i}
                  onClick={() => seekToChapter(ch)}
                  className={`flex w-full items-center justify-between px-4 py-2 text-left text-sm hover:bg-muted/50 transition-colors ${
                    ch.trackIndex === store.currentTrackIndex &&
                    store.positionSeconds >= ch.startTime &&
                    store.positionSeconds < ch.endTime
                      ? 'bg-primary/10 font-medium'
                      : ''
                  }`}
                >
                  <span className="truncate">{ch.title}</span>
                  <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                    {formatTime(ch.startTime)}
                  </span>
                </button>
              ))}
            </div>
          ) : tracks && tracks.length > 1 ? (
            <div className="max-h-64 overflow-y-auto">
              {tracks.map((track, i) => (
                <button
                  key={track.id || i}
                  onClick={() => switchTrack(i)}
                  className={`flex w-full items-center justify-between px-4 py-2 text-left text-sm hover:bg-muted/50 transition-colors ${
                    i === store.currentTrackIndex ? 'bg-primary/10 font-medium' : ''
                  }`}
                >
                  <span className="truncate">{track.title || `Track ${i + 1}`}</span>
                  <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                    {formatTime(track.durationSeconds)}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="p-4 text-center text-sm text-muted-foreground">No chapters available</p>
          )}
        </div>
      )}
    </div>
  );
}
