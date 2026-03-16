import { useEffect, useRef, useCallback } from 'react';
import { Play, Pause, SkipForward, SkipBack, X, Maximize2, ChevronLeft, ChevronRight } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { Button } from '../ui/button';
import { useAudioStore } from '../../stores/audioStore';
import { AudioEngine } from '../../lib/AudioEngine';
import { formatTime } from '../../lib/format';

export function AudioMiniPlayer() {
  const { bookId, bookTitle, bookAuthor, coverUrl, positionSeconds, totalDurationSeconds, isPlaying, setPlaying, stop, currentTrackIndex, chapters } =
    useAudioStore();
  const reloadedRef = useRef(false);
  const progressBarRef = useRef<HTMLDivElement>(null);

  // Reload audio source if store has persisted state but AudioEngine has no source
  // (happens after page refresh — store persists via localStorage, AudioEngine doesn't)
  useEffect(() => {
    if (!bookId || reloadedRef.current) return;
    if (AudioEngine.duration === 0 && !AudioEngine.paused) {
      // AudioEngine has nothing loaded — reload the track
      const url = `/api/audiobooks/${bookId}/stream/${currentTrackIndex}`;
      AudioEngine.load(url);
      if (positionSeconds > 0) {
        setTimeout(() => AudioEngine.seek(positionSeconds), 300);
      }
    }
    reloadedRef.current = true;
  }, [bookId, currentTrackIndex, positionSeconds]);

  const togglePlay = () => {
    if (isPlaying) {
      AudioEngine.pause();
      setPlaying(false);
    } else {
      AudioEngine.play();
      setPlaying(true);
    }
  };

  const handleStop = () => {
    AudioEngine.pause();
    AudioEngine.seek(0);
    stop();
  };

  const handleProgressClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const bar = progressBarRef.current;
    if (!bar || totalDurationSeconds <= 0) return;
    const rect = bar.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    AudioEngine.seek(pct * totalDurationSeconds);
  }, [totalDurationSeconds]);

  const prevChapter = useCallback(() => {
    if (!chapters || chapters.length === 0) return;
    const current = [...chapters].reverse().find(c => c.startTime < positionSeconds - 2);
    if (current) AudioEngine.seek(current.startTime);
    else AudioEngine.seek(0);
  }, [chapters, positionSeconds]);

  const nextChapter = useCallback(() => {
    if (!chapters || chapters.length === 0) return;
    const next = chapters.find(c => c.startTime > positionSeconds + 1);
    if (next) AudioEngine.seek(next.startTime);
  }, [chapters, positionSeconds]);

  // Round to nearest second so progress bar re-renders ~1/s instead of every frame
  const roundedPosition = Math.floor(positionSeconds);
  const progress = totalDurationSeconds > 0 ? (roundedPosition / totalDurationSeconds) * 100 : 0;

  return (
    <div className="border-t bg-card">
      {/* Progress bar */}
      <div
        ref={progressBarRef}
        className="h-1.5 w-full bg-muted cursor-pointer group"
        onClick={handleProgressClick}
      >
        <div className="h-full bg-primary transition-all group-hover:bg-primary/80" style={{ width: `${progress}%` }} />
      </div>

      <div className="flex items-center gap-3 px-4 py-2">
        {/* Cover thumbnail — click to open listen page */}
        {coverUrl && bookId && (
          <Link to="/library/$bookId/listen" params={{ bookId: String(bookId) }} className="hidden sm:block">
            <div className="h-10 w-10 shrink-0 overflow-hidden rounded cursor-pointer">
              <img src={coverUrl} alt="" className="h-full w-full object-cover" />
            </div>
          </Link>
        )}

        {/* Book info */}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{bookTitle}</p>
          <p className="truncate text-xs text-muted-foreground">{bookAuthor}</p>
        </div>

        {/* Time */}
        <span className="hidden text-xs text-muted-foreground sm:block">
          {formatTime(positionSeconds)} / {formatTime(totalDurationSeconds)}
        </span>

        {/* Controls */}
        <div className="flex items-center gap-1">
          {chapters.length > 0 && (
            <Button variant="ghost" size="icon" className="hidden h-8 w-8 sm:inline-flex" onClick={prevChapter}>
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => AudioEngine.seek(Math.max(0, AudioEngine.currentTime - 30))}>
            <SkipBack className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={togglePlay}>
            {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => AudioEngine.seek(AudioEngine.currentTime + 30)}>
            <SkipForward className="h-3.5 w-3.5" />
          </Button>
          {chapters.length > 0 && (
            <Button variant="ghost" size="icon" className="hidden h-8 w-8 sm:inline-flex" onClick={nextChapter}>
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          )}
          {bookId && (
            <Link to="/library/$bookId/listen" params={{ bookId: String(bookId) }}>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <Maximize2 className="h-3.5 w-3.5" />
              </Button>
            </Link>
          )}
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleStop}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
