import { Play, Pause, SkipForward, SkipBack, X } from 'lucide-react';
import { Button } from '../ui/button';
import { useAudioStore } from '../../stores/audioStore';
import { AudioEngine } from '../../lib/AudioEngine';

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function AudioMiniPlayer() {
  const { bookTitle, bookAuthor, positionSeconds, totalDurationSeconds, isPlaying, setPlaying, stop } =
    useAudioStore();

  const togglePlay = () => {
    if (isPlaying) {
      AudioEngine.pause();
      setPlaying(false);
    } else {
      AudioEngine.play();
      setPlaying(true);
    }
  };

  const progress = totalDurationSeconds > 0 ? (positionSeconds / totalDurationSeconds) * 100 : 0;

  return (
    <div className="border-t bg-card">
      {/* Progress bar */}
      <div className="h-1 w-full bg-muted">
        <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
      </div>

      <div className="flex items-center gap-3 px-4 py-2">
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
          <Button variant="ghost" size="icon" onClick={() => AudioEngine.seek(Math.max(0, AudioEngine.currentTime - 30))}>
            <SkipBack className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={togglePlay}>
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </Button>
          <Button variant="ghost" size="icon" onClick={() => AudioEngine.seek(AudioEngine.currentTime + 30)}>
            <SkipForward className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={stop}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
