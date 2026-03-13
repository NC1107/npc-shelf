import { eq, sql, isNull } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import type { MetadataProvider } from '../providers/metadata-provider.js';
import type { MetadataMatchResult, MetadataSearchResult } from '@npc-shelf/shared';
import { METADATA } from '@npc-shelf/shared';
import { stringSimilarity, normalizeForComparison } from '../utils/string-similarity.js';
import { downloadAndResizeCover } from './cover.js';
import { HardcoverProvider } from '../providers/hardcover.js';

// Singleton provider — re-initialized when API token changes
let provider: HardcoverProvider = new HardcoverProvider(
  process.env.HARDCOVER_API_TOKEN,
);
let tokenLoaded = false;

function ensureToken() {
  if (tokenLoaded) return;
  tokenLoaded = true;
  try {
    const row = db
      .select()
      .from(schema.settings)
      .where(eq(schema.settings.key, 'hardcoverApiToken'))
      .get();
    if (row?.value) {
      const token = row.value.startsWith('Bearer ') ? row.value.slice(7) : row.value;
      provider.setToken(token);
      console.log('[Metadata] Loaded Hardcover API token from settings');
    }
  } catch {
    // DB may not be ready yet
  }
}

export function getProvider(): HardcoverProvider {
  ensureToken();
  return provider;
}

export function updateProviderToken(token: string) {
  const cleaned = token.startsWith('Bearer ') ? token.slice(7) : token;
  provider.setToken(cleaned);
  tokenLoaded = true;
}

/**
 * Match a single book against the metadata provider.
 * Pipeline: ISBN -> Title+Author -> Title-only
 */
export async function matchBook(
  prov: MetadataProvider,
  title: string,
  author?: string,
  isbn?: string,
): Promise<MetadataMatchResult | null> {
  // Step 1: Search by ISBN (highest confidence)
  if (isbn) {
    const results = await prov.searchByIsbn(isbn);
    if (results.length > 0) {
      return {
        ...results[0]!,
        confidence: METADATA.HIGH_CONFIDENCE_THRESHOLD,
        provider: prov.name,
      };
    }
  }

  // Step 2: Search by title + author
  const results = await prov.searchByTitle(title, author);
  if (results.length === 0) return null;

  // Score results by similarity
  const scored = results.map((result) => {
    const titleSim = stringSimilarity(
      normalizeForComparison(title),
      normalizeForComparison(result.title),
    );
    const authorSim = author && result.authors.length > 0
      ? stringSimilarity(
          normalizeForComparison(author),
          normalizeForComparison(result.authors[0]!),
        )
      : 0;

    const confidence = author
      ? titleSim * 0.6 + authorSim * 0.4
      : titleSim * 0.8;

    return { ...result, confidence, provider: prov.name };
  });

  scored.sort((a, b) => b.confidence - a.confidence);
  const best = scored[0]!;

  return best.confidence >= METADATA.LOW_CONFIDENCE_THRESHOLD ? best : null;
}

/**
 * Match and enrich a single book by its database ID.
 * Downloads cover and updates all metadata.
 */
export async function enrichBook(bookId: number): Promise<void> {
  const book = db.select().from(schema.books).where(eq(schema.books.id, bookId)).get();
  if (!book) return;

  // Get existing author for matching
  const authorRow = db
    .select({ name: schema.authors.name })
    .from(schema.bookAuthors)
    .innerJoin(schema.authors, eq(schema.bookAuthors.authorId, schema.authors.id))
    .where(eq(schema.bookAuthors.bookId, bookId))
    .get();

  const isbn = book.isbn13 || book.isbn10 || undefined;
  ensureToken();
  const match = await matchBook(provider, book.title, authorRow?.name, isbn);

  if (!match) {
    console.log(`[Metadata] No match found for "${book.title}"`);
    return;
  }

  console.log(`[Metadata] Matched "${book.title}" -> "${match.title}" (${(match.confidence * 100).toFixed(0)}% confidence)`);

  // Update book metadata
  const updates: Record<string, any> = {
    hardcoverId: match.externalId,
    matchConfidence: match.confidence,
    updatedAt: new Date().toISOString(),
  };

  // Only overwrite fields that are currently empty
  if (!book.description && match.description) updates.description = match.description;
  if (!book.publishDate && match.publishDate) updates.publishDate = match.publishDate;
  if (!book.isbn13 && match.isbn13) updates.isbn13 = match.isbn13;

  db.update(schema.books).set(updates).where(eq(schema.books.id, bookId)).run();

  // Download cover if we don't have one
  if (!book.coverPath && match.coverUrl) {
    const coverPath = await downloadAndResizeCover(match.coverUrl, bookId);
    if (coverPath) {
      db.update(schema.books).set({ coverPath }).where(eq(schema.books.id, bookId)).run();
    }
  }

  // Add series if not already set
  if (match.series) {
    const existingSeries = db
      .select()
      .from(schema.bookSeries)
      .where(eq(schema.bookSeries.bookId, bookId))
      .get();

    if (!existingSeries) {
      let seriesRow = db.select().from(schema.series).where(eq(schema.series.name, match.series)).get();
      if (!seriesRow) {
        seriesRow = db.insert(schema.series).values({ name: match.series }).returning().get();
      }
      db.insert(schema.bookSeries)
        .values({ bookId, seriesId: seriesRow.id, position: match.seriesPosition })
        .onConflictDoNothing()
        .run();
    }
  }

  // Cache the raw metadata
  db.insert(schema.metadataCache)
    .values({
      bookId,
      provider: match.provider,
      externalId: match.externalId,
      rawData: JSON.stringify(match),
      fetchedAt: new Date().toISOString(),
    })
    .onConflictDoNothing()
    .run();
}

/**
 * Batch match all unmatched books.
 */
export async function enrichAllUnmatched(): Promise<{ matched: number; total: number }> {
  const unmatched = db
    .select({ id: schema.books.id })
    .from(schema.books)
    .where(isNull(schema.books.hardcoverId))
    .all();

  let matched = 0;
  for (const book of unmatched) {
    try {
      await enrichBook(book.id);
      // Check if it was matched
      const updated = db.select({ hardcoverId: schema.books.hardcoverId }).from(schema.books).where(eq(schema.books.id, book.id)).get();
      if (updated?.hardcoverId) matched++;
    } catch (err) {
      console.error(`[Metadata] Error enriching book ${book.id}:`, err);
    }
  }

  return { matched, total: unmatched.length };
}

/**
 * Search the provider directly (for manual matching UI).
 */
export async function searchProvider(query: string): Promise<MetadataSearchResult[]> {
  ensureToken();
  return provider.searchByTitle(query);
}

/**
 * Apply a specific metadata match to a book (manual matching).
 */
export async function applyMatch(bookId: number, externalId: string): Promise<void> {
  ensureToken();
  const details = await provider.getDetails(externalId);
  if (!details) return;

  const updates: Record<string, any> = {
    hardcoverId: externalId,
    matchConfidence: 1.0,
    updatedAt: new Date().toISOString(),
  };

  if (details.description) updates.description = details.description;
  if (details.publishDate) updates.publishDate = details.publishDate;
  if (details.isbn13) updates.isbn13 = details.isbn13;

  db.update(schema.books).set(updates).where(eq(schema.books.id, bookId)).run();

  if (details.coverUrl) {
    const coverPath = await downloadAndResizeCover(details.coverUrl, bookId);
    if (coverPath) {
      db.update(schema.books).set({ coverPath }).where(eq(schema.books.id, bookId)).run();
    }
  }

  // Cache
  db.insert(schema.metadataCache)
    .values({
      bookId,
      provider: provider.name,
      externalId,
      rawData: JSON.stringify(details),
      fetchedAt: new Date().toISOString(),
    })
    .onConflictDoNothing()
    .run();
}
