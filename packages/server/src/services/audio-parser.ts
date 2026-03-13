import type { AudioChapter } from '@npc-shelf/shared';

/**
 * Parse audio metadata from M4B/MP3 files.
 * Uses music-metadata for ID3 tags and ffprobe for M4B chapters.
 * Full implementation in Phase 6.
 */
export interface AudioMetadata {
  title: string | null;
  artist: string | null;
  album: string | null;
  duration: number;
  chapters: AudioChapter[];
  coverImage: Buffer | null;
}

export async function parseAudioMetadata(filePath: string): Promise<AudioMetadata> {
  // TODO: Implement using music-metadata and ffprobe
  return {
    title: null,
    artist: null,
    album: null,
    duration: 0,
    chapters: [],
    coverImage: null,
  };
}
