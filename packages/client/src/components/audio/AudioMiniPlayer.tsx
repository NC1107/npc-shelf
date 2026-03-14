import { useEffect, useRef } from 'react';
import { Play, Pause, SkipForward, SkipBack, X, Maximize2 } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { Button } from '../ui/button';
import { useAudioStore } from '../../stores/audioStore';
import { AudioEngine } from '../../lib/AudioEngine';

function formatTime(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function AudioMiniPlayer() {
  const { bookId, bookTitle, bookAuthor, coverUrl, positionSeconds, totalDurationSeconds, isPlaying, setPlaying, stop, currentTrackIndex } =
    useAudioStore();
  const reloadedRef = useRef(false);

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

  // Round to nearest second so progress bar re-renders ~1/s instead of every frame
  const roundedPosition = Math.floor(positionSeconds);
  const progress = totalDurationSeconds > 0 ? (roundedPosition / totalDurationSeconds) * 100 : 0;

  return (
    <div className="border-t bg-card">
      {/* Progress bar */}
      <div className="h-1 w-full bg-muted">
        <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
      </div>

      <div className="flex items-center gap-3 px-4 py-2">
        {/* Cover thumbnail */}
        {coverUrl && (
          <div className="hidden h-10 w-10 shrink-0 overflow-hidden rounded sm:block">
            <img src={coverUrl} alt="" className="h-full w-full object-cover" />
          </div>
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
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => AudioEngine.seek(Math.max(0, AudioEngine.currentTime - 30))}>
            <SkipBack className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={togglePlay}>
            {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => AudioEngine.seek(AudioEngine.currentTime + 30)}>
            <SkipForward className="h-3.5 w-3.5" />
          </Button>
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
