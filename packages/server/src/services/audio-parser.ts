import { parseFile } from 'music-metadata';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const execFileAsync = promisify(execFile);

export interface AudioChapterRaw {
  title: string;
  startTime: number;
  endTime: number;
}

export interface AudioMetadata {
  title: string | null;
  artist: string | null;
  album: string | null;
  albumArtist: string | null;
  year: number | null;
  duration: number;
  chapters: AudioChapterRaw[];
  coverImage: Buffer | null;
}

/**
 * Parse audio metadata from MP3/M4B files.
 * Uses music-metadata for tags and cover art.
 * Uses ffprobe for M4B chapter extraction.
 */
export async function parseAudioMetadata(filePath: string): Promise<AudioMetadata> {
  const result: AudioMetadata = {
    title: null,
    artist: null,
    album: null,
    albumArtist: null,
    year: null,
    duration: 0,
    chapters: [],
    coverImage: null,
  };

  try {
    // Parse with music-metadata (works for both MP3 and M4B)
    const metadata = await parseFile(filePath, { duration: true });

    result.title = metadata.common.title || null;
    result.artist = metadata.common.artist || null;
    result.album = metadata.common.album || null;
    result.albumArtist = metadata.common.albumartist || null;
    result.year = metadata.common.year || null;
    result.duration = metadata.format.duration || 0;

    // Extract cover image
    if (metadata.common.picture && metadata.common.picture.length > 0) {
      result.coverImage = Buffer.from(metadata.common.picture[0]!.data);
    }

    // For M4B files, extract chapters via ffprobe
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.m4b') {
      result.chapters = await extractChaptersWithFfprobe(filePath);
    }
  } catch (err) {
    console.error(`[AudioParser] Error parsing ${filePath}:`, err);
  }

  return result;
}

/**
 * Extract chapter information from M4B using ffprobe.
 * Falls back gracefully if ffprobe is not available.
 */
async function extractChaptersWithFfprobe(filePath: string): Promise<AudioChapterRaw[]> {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_chapters',
      filePath,
    ], { timeout: 30000 });

    const data = JSON.parse(stdout);
    if (!data.chapters || !Array.isArray(data.chapters)) return [];

    return data.chapters.map((ch: any, index: number) => ({
      title: ch.tags?.title || `Chapter ${index + 1}`,
      startTime: parseFloat(ch.start_time) || 0,
      endTime: parseFloat(ch.end_time) || 0,
    }));
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      console.warn('[AudioParser] ffprobe not found — skipping chapter extraction for M4B');
    } else {
      console.error('[AudioParser] ffprobe error:', err.message);
    }
    return [];
  }
}

/**
 * Parse duration of an audio file without reading full metadata.
 * Useful for quick duration checks.
 */
export async function getAudioDuration(filePath: string): Promise<number> {
  try {
    const metadata = await parseFile(filePath, { duration: true, skipCovers: true });
    return metadata.format.duration || 0;
  } catch {
    return 0;
  }
}
