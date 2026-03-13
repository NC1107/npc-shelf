import fs from 'node:fs';
import path from 'node:path';
import { db, schema } from '../db/index.js';
import { extractAndCacheCover } from './cover.js';
import { isNotNull } from 'drizzle-orm';

const COVER_CACHE_DIR = process.env.COVER_CACHE_PATH || './cache/covers';

/**
 * Scan for books that have an _original cover but are missing WebP resizes.
 * Re-generates thumb/medium/full WebP variants from the original.
 */
export async function backfillCovers(): Promise<{ processed: number; errors: number }> {
  const books = db
    .select({ id: schema.books.id, coverPath: schema.books.coverPath })
    .from(schema.books)
    .where(isNotNull(schema.books.coverPath))
    .all();

  let processed = 0;
  let errors = 0;

  for (const book of books) {
    const thumbPath = path.join(COVER_CACHE_DIR, `${book.id}_thumb.webp`);

    // Skip if WebP variants already exist
    if (fs.existsSync(thumbPath)) continue;

    // Find the original file
    const originalPath = path.join(COVER_CACHE_DIR, `${book.id}_original`);
    if (!fs.existsSync(originalPath)) continue;

    try {
      const buffer = fs.readFileSync(originalPath);
      await extractAndCacheCover(buffer, book.id);
      processed++;
      console.log(`[CoverBackfill] Generated WebP for book ${book.id}`);
    } catch (err) {
      errors++;
      console.error(`[CoverBackfill] Error processing book ${book.id}:`, err);
    }
  }

  console.log(`[CoverBackfill] Done: ${processed} processed, ${errors} errors`);
  return { processed, errors };
}
