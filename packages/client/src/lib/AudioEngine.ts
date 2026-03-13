/**
 * Singleton HTMLAudioElement manager.
 * Lives outside React to persist across route navigation.
 */
class AudioEngineClass {
  private audio: HTMLAudioElement;
  private onTimeUpdateCb: ((time: number) => void) | null = null;
  private onEndedCb: (() => void) | null = null;

  constructor() {
    this.audio = new Audio();
    this.audio.preload = 'auto';

    this.audio.addEventListener('timeupdate', () => {
      this.onTimeUpdateCb?.(this.audio.currentTime);
    });

    this.audio.addEventListener('ended', () => {
      this.onEndedCb?.();
    });
  }

  load(url: string) {
    this.audio.src = url;
    this.audio.load();
  }

  play() {
    return this.audio.play();
  }

  pause() {
    this.audio.pause();
  }

  seek(time: number) {
    this.audio.currentTime = time;
  }

  get currentTime() {
    return this.audio.currentTime;
  }

  get duration() {
    return this.audio.duration || 0;
  }

  get paused() {
    return this.audio.paused;
  }

  set playbackRate(rate: number) {
    this.audio.playbackRate = rate;
  }

  get playbackRate() {
    return this.audio.playbackRate;
  }

  set volume(vol: number) {
    this.audio.volume = Math.max(0, Math.min(1, vol));
  }

  get volume() {
    return this.audio.volume;
  }

  onTimeUpdate(cb: (time: number) => void) {
    this.onTimeUpdateCb = cb;
  }

  onEnded(cb: () => void) {
    this.onEndedCb = cb;
  }

  setupMediaSession(metadata: { title: string; artist: string; album: string; coverUrl?: string }) {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: metadata.title,
        artist: metadata.artist,
        album: metadata.album,
        artwork: metadata.coverUrl
          ? [{ src: metadata.coverUrl, sizes: '400x600', type: 'image/webp' }]
          : [],
      });
    }
  }
}

export const AudioEngine = new AudioEngineClass();
