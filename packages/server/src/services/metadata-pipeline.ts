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

    const titleWeight = author ? 0.6 : 0.8;
    const authorWeight = author ? 0.4 : 0;
    const confidence = titleSim * titleWeight + authorSim * authorWeight;

    return {
      ...result,
      confidence,
      provider: prov.name,
      matchBreakdown: {
        titleSimilarity: titleSim,
        authorSimilarity: authorSim,
        titleWeight,
        authorWeight,
        localTitle: title,
        matchedTitle: result.title,
        localAuthor: author || null,
        matchedAuthor: result.authors[0] || null,
      },
    };
  });

  scored.sort((a, b) => b.confidence - a.confidence);

  // Log query and top results for diagnostics
  console.log(`[Metadata] Query: title="${title}" author="${author || ''}" → ${scored.length} results`);
  for (const s of scored.slice(0, 3)) {
    const bd = s.matchBreakdown;
    console.log(`[Metadata]   "${s.title}" by ${s.authors[0] || '?'}: title=${bd.titleSimilarity.toFixed(2)} author=${bd.authorSimilarity.toFixed(2)} → ${(s.confidence * 100).toFixed(0)}%`);
  }

  const best = scored[0]!;

  // Hard floor: reject if title similarity is too low (prevents garbage matches)
  if (best.matchBreakdown.titleSimilarity < 0.3) {
    console.log(`[Metadata] Rejected "${best.title}" — title similarity ${best.matchBreakdown.titleSimilarity.toFixed(2)} below hard floor 0.30`);
    return null;
  }

  // Require minimum title similarity to prevent false positives from high author scores
  if (best.matchBreakdown.titleSimilarity < 0.5) {
    console.log(`[Metadata] Rejected "${best.title}" — title similarity ${best.matchBreakdown.titleSimilarity.toFixed(2)} below title gate 0.50`);
    return null;
  }

  if (best.confidence < METADATA.LOW_CONFIDENCE_THRESHOLD) {
    console.log(`[Metadata] Rejected "${best.title}" — confidence ${(best.confidence * 100).toFixed(0)}% below threshold ${(METADATA.LOW_CONFIDENCE_THRESHOLD * 100).toFixed(0)}%`);
    return null;
  }

  return best;
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

  // If we matched via search (no slug), fetch details to get slug + all series
  let slug = match.slug;
  let allSeries = match.allSeries;
  if (!slug) {
    const details = await provider.getDetails(match.externalId);
    if (details) {
      slug = details.slug;
      allSeries = details.allSeries;
    }
  }

  // Update book metadata
  const updates: Record<string, any> = {
    hardcoverId: match.externalId,
    hardcoverSlug: slug || null,
    matchConfidence: match.confidence,
    matchBreakdown: (match as any).matchBreakdown ? JSON.stringify((match as any).matchBreakdown) : null,
    updatedAt: new Date().toISOString(),
  };

  // Only overwrite fields that are currently empty
  if (!book.description && match.description) updates.description = match.description;
  if (!book.publishDate && match.publishDate) updates.publishDate = match.publishDate;
  if (!book.isbn13 && match.isbn13) updates.isbn13 = match.isbn13;
  if (!book.pageCount && match.pageCount) updates.pageCount = match.pageCount;
  if (!book.isbn10 && match.isbn10) updates.isbn10 = match.isbn10;

  db.update(schema.books).set(updates).where(eq(schema.books.id, bookId)).run();

  // Download cover if we don't have one
  if (!book.coverPath && match.coverUrl) {
    const coverPath = await downloadAndResizeCover(match.coverUrl, bookId);
    if (coverPath) {
      db.update(schema.books).set({ coverPath }).where(eq(schema.books.id, bookId)).run();
    }
  }

  // Add series if not already set
  const existingSeries = db
    .select()
    .from(schema.bookSeries)
    .where(eq(schema.bookSeries.bookId, bookId))
    .get();

  if (!existingSeries) {
    if (allSeries && allSeries.length > 0) {
      for (const s of allSeries) {
        let seriesRow = db.select().from(schema.series).where(eq(schema.series.name, s.name)).get();
        if (!seriesRow) {
          seriesRow = db.insert(schema.series).values({ name: s.name, hardcoverId: s.seriesId || null }).returning().get();
        }
        db.insert(schema.bookSeries)
          .values({ bookId, seriesId: seriesRow.id, position: s.position })
          .onConflictDoNothing()
          .run();

        // Fetch series-level metadata (description) if not already set
        if (!seriesRow.description && s.seriesId) {
          try {
            const seriesDetails = await provider.getSeriesDetails(s.seriesId);
            if (seriesDetails?.description) {
              db.update(schema.series)
                .set({ description: seriesDetails.description })
                .where(eq(schema.series.id, seriesRow.id))
                .run();
            }
          } catch { /* ignore series detail fetch errors */ }
        }
      }
    } else if (match.series) {
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

  // Enrich author details (bio, photo) from Hardcover
  await enrichAuthorsFromMatch(bookId);

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

  // Create tags from metadata
  if (match.tags && match.tags.length > 0) {
    for (const tagName of match.tags) {
      let tag = db.select().from(schema.tags).where(eq(schema.tags.name, tagName)).get();
      if (!tag) {
        tag = db.insert(schema.tags).values({ name: tagName, source: 'hardcover' }).returning().get();
      }
      db.insert(schema.bookTags)
        .values({ bookId, tagId: tag.id })
        .onConflictDoNothing()
        .run();
    }
  }
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
    hardcoverSlug: details.slug || null,
    matchConfidence: 1.0,
    updatedAt: new Date().toISOString(),
  };

  if (details.description) updates.description = details.description;
  if (details.publishDate) updates.publishDate = details.publishDate;
  if (details.isbn13) updates.isbn13 = details.isbn13;
  if (details.pageCount) updates.pageCount = details.pageCount;
  if (details.isbn10) updates.isbn10 = details.isbn10;

  db.update(schema.books).set(updates).where(eq(schema.books.id, bookId)).run();

  if (details.coverUrl) {
    const coverPath = await downloadAndResizeCover(details.coverUrl, bookId);
    if (coverPath) {
      db.update(schema.books).set({ coverPath }).where(eq(schema.books.id, bookId)).run();
    }
  }

  // Add all series from details
  if (details.allSeries && details.allSeries.length > 0) {
    for (const s of details.allSeries) {
      let seriesRow = db.select().from(schema.series).where(eq(schema.series.name, s.name)).get();
      if (!seriesRow) {
        seriesRow = db.insert(schema.series).values({ name: s.name, hardcoverId: s.seriesId || null }).returning().get();
      }
      db.insert(schema.bookSeries)
        .values({ bookId, seriesId: seriesRow.id, position: s.position })
        .onConflictDoNothing()
        .run();
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

  // Create tags from metadata
  if (details.tags && details.tags.length > 0) {
    for (const tagName of details.tags) {
      let tag = db.select().from(schema.tags).where(eq(schema.tags.name, tagName)).get();
      if (!tag) {
        tag = db.insert(schema.tags).values({ name: tagName, source: 'hardcover' }).returning().get();
      }
      db.insert(schema.bookTags)
        .values({ bookId, tagId: tag.id })
        .onConflictDoNothing()
        .run();
    }
  }
}

/**
 * Enrich local author records with bio and photo from Hardcover.
 * Fetches Hardcover author IDs from the book's contributions,
 * then queries each author for bio/photo.
 */
async function enrichAuthorsFromMatch(bookId: number): Promise<void> {
  const book = db.select().from(schema.books).where(eq(schema.books.id, bookId)).get();
  if (!book?.hardcoverId) return;

  const localAuthors = db.select({
    authorId: schema.bookAuthors.authorId,
    name: schema.authors.name,
    bio: schema.authors.bio,
    photoUrl: schema.authors.photoUrl,
  })
    .from(schema.bookAuthors)
    .innerJoin(schema.authors, eq(schema.bookAuthors.authorId, schema.authors.id))
    .where(eq(schema.bookAuthors.bookId, bookId))
    .all();

  // Skip if all authors already have bio and photo
  const needsEnrichment = localAuthors.filter(a => !a.bio || !a.photoUrl);
  if (needsEnrichment.length === 0) return;

  // Get Hardcover author IDs from the book's contributions
  const hcAuthors = await provider.getBookAuthorIds(book.hardcoverId);
  if (hcAuthors.length === 0) return;

  for (const localAuthor of needsEnrichment) {
    const normalizedLocal = normalizeForComparison(localAuthor.name);

    // Match local author to Hardcover author by name similarity
    const hcMatch = hcAuthors.find(
      (a) => stringSimilarity(normalizeForComparison(a.name), normalizedLocal) > 0.85,
    );
    if (!hcMatch) continue;

    try {
      const details = await provider.getAuthorDetails(String(hcMatch.id));
      if (!details) continue;

      const updates: Record<string, string> = {};
      if (!localAuthor.bio && details.bio) updates.bio = details.bio;
      if (!localAuthor.photoUrl && details.imageUrl) updates.photoUrl = details.imageUrl;

      if (Object.keys(updates).length > 0) {
        db.update(schema.authors)
          .set(updates)
          .where(eq(schema.authors.id, localAuthor.authorId))
          .run();
        console.log(`[Metadata] Enriched author "${localAuthor.name}" with ${Object.keys(updates).join(', ')}`);
      }
    } catch (err) {
      console.warn(`[Metadata] Failed to enrich author "${localAuthor.name}":`, err);
    }
  }
}
