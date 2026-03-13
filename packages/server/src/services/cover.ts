import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const COVER_CACHE_DIR = process.env.COVER_CACHE_PATH || './cache/covers';

interface CoverSizes {
  thumb: { width: number; height: number };
  medium: { width: number; height: number };
  full: { width: number; height: number };
}

const SIZES: CoverSizes = {
  thumb: { width: 200, height: 300 },
  medium: { width: 400, height: 600 },
  full: { width: 800, height: 1200 },
};

/**
 * Download cover image from URL and resize to standard sizes.
 * Saves as WebP for optimal file size.
 */
export async function downloadAndResizeCover(
  url: string,
  bookId: number,
): Promise<string | null> {
  try {
    fs.mkdirSync(COVER_CACHE_DIR, { recursive: true });

    // Download image
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`[Cover] Failed to download from ${url}: ${response.status}`);
      return null;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    return resizeAndSave(buffer, bookId);
  } catch (err) {
    console.error(`[Cover] Download error for book ${bookId}:`, err);
    return null;
  }
}

/**
 * Resize an existing image buffer and save to cache.
 */
export async function extractAndCacheCover(
  imageBuffer: Buffer,
  bookId: number,
): Promise<string | null> {
  try {
    fs.mkdirSync(COVER_CACHE_DIR, { recursive: true });
    return resizeAndSave(imageBuffer, bookId);
  } catch (err) {
    console.error(`[Cover] Cache error for book ${bookId}:`, err);
    return null;
  }
}

async function resizeAndSave(buffer: Buffer, bookId: number): Promise<string> {
  // Save original
  const originalPath = path.join(COVER_CACHE_DIR, `${bookId}_original`);
  fs.writeFileSync(originalPath, buffer);

  // Create resized versions
  for (const [sizeName, dims] of Object.entries(SIZES)) {
    const outPath = path.join(COVER_CACHE_DIR, `${bookId}_${sizeName}.webp`);
    try {
      await sharp(buffer)
        .resize(dims.width, dims.height, { fit: 'cover', position: 'top' })
        .webp({ quality: 80 })
        .toFile(outPath);
    } catch (err) {
      console.error(`[Cover] Resize error for ${sizeName}:`, err);
    }
  }

  return originalPath;
}

/**
 * Get cover file path for a specific size.
 */
export function getCoverPath(bookId: number, size: 'thumb' | 'medium' | 'full'): string {
  return path.join(COVER_CACHE_DIR, `${bookId}_${size}.webp`);
}
