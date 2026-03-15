import { parseFile } from 'music-metadata';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';

const execFileAsync = promisify(execFile);

/** Timeout for music-metadata parseFile — large M4B files can hang */
const PARSE_TIMEOUT_MS = 60_000;

/** Max file size for full metadata parsing (500MB). Larger files get minimal parsing. */
const FULL_PARSE_MAX_BYTES = 500 * 1024 * 1024;

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
    // Skip full metadata parsing for very large files to avoid OOM
    const stat = fs.statSync(filePath);
    const isLargeFile = stat.size > FULL_PARSE_MAX_BYTES;

    if (isLargeFile) {
      console.log(`[AudioParser] Large file (${(stat.size / 1024 / 1024).toFixed(0)}MB), using minimal parsing: ${path.basename(filePath)}`);
    }

    // Parse with music-metadata with a timeout guard
    const parsePromise = parseFile(filePath, {
      duration: true,
      skipCovers: isLargeFile,
    });
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('parseFile timeout')), PARSE_TIMEOUT_MS),
    );

    const metadata = await Promise.race([parsePromise, timeoutPromise]);

    result.title = metadata.common.title || null;
    result.artist = metadata.common.artist || null;
    result.album = metadata.common.album || null;
    result.albumArtist = metadata.common.albumartist || null;
    result.year = metadata.common.year || null;
    result.duration = metadata.format.duration || 0;

    // Extract cover image (skip for large files)
    if (!isLargeFile && metadata.common.picture && metadata.common.picture.length > 0) {
      result.coverImage = Buffer.from(metadata.common.picture[0].data);
    }

    // For M4B files, extract chapters via ffprobe
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.m4b') {
      result.chapters = await extractChaptersWithFfprobe(filePath);
    }
  } catch (err: any) {
    if (err?.message === 'parseFile timeout') {
      console.warn(`[AudioParser] Timeout parsing ${path.basename(filePath)} — skipping metadata`);
    } else {
      console.error(`[AudioParser] Error parsing ${filePath}:`, err);
    }
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
      startTime: Number.parseFloat(ch.start_time) || 0,
      endTime: Number.parseFloat(ch.end_time) || 0,
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
