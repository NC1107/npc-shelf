import fs from 'node:fs';
import path from 'node:path';
import { COVER_SIZES } from '@npc-shelf/shared';

const COVER_CACHE_DIR = process.env.COVER_CACHE_PATH || './cache/covers';

/**
 * Download and resize cover images.
 * Full implementation in Phase 4.
 */
export async function downloadAndResizeCover(
  url: string,
  bookId: number,
): Promise<string | null> {
  // TODO: Implement with sharp
  // 1. Download image from URL
  // 2. Resize to thumb (200x300), medium (400x600), full (800x1200)
  // 3. Save as WebP to cache directory
  // 4. Return the cover path

  fs.mkdirSync(COVER_CACHE_DIR, { recursive: true });
  return null;
}

export async function extractAndCacheCover(
  imageBuffer: Buffer,
  bookId: number,
): Promise<string | null> {
  // TODO: Implement with sharp
  fs.mkdirSync(COVER_CACHE_DIR, { recursive: true });
  return null;
}
