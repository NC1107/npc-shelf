import { eq, isNull, isNotNull } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import type { MetadataProvider } from '../providers/metadata-provider.js';
import type { MetadataMatchResult, MetadataSearchResult } from '@npc-shelf/shared';
import { METADATA } from '@npc-shelf/shared';
import { stringSimilarity, normalizeForComparison } from '../utils/string-similarity.js';
import { cleanTitle, parseFilename, getDirAuthorHint } from '../utils/filename-parser.js';
import { downloadAndResizeCover } from './cover.js';
import { HardcoverProvider } from '../providers/hardcover.js';

// Singleton provider — re-initialized when API token changes
const provider: HardcoverProvider = new HardcoverProvider(
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

// ===== Scoring Model =====

export interface ScoringContext {
  localTitle: string;
  localAuthor: string | null;
  localSeries: string | null;
  localSeriesPosition: number | null;
  directoryAuthor: string | null;
  isAudiobook: boolean;
}

export interface ScoreBreakdown {
  titleScore: number;       // 0-50
  authorScore: number;      // 0-30
  seriesBonus: number;      // 0 or 10
  indexBonus: number;        // 0 or 5
  formatBonus: number;      // 0 or 5
  dirAuthorBonus: number;   // 0 or 5
  authorPenalty: number;    // 0 or -30
  total: number;            // sum, clamped 0-100
  // Legacy fields for tooltip compatibility
  titleSimilarity: number;
  authorSimilarity: number;
  titleWeight: number;
  authorWeight: number;
  localTitle: string;
  matchedTitle: string;
  localAuthor: string | null;
  matchedAuthor: string | null;
}

export function scoreResult(result: MetadataSearchResult, context: ScoringContext): ScoreBreakdown {
  const titleSim = stringSimilarity(
    normalizeForComparison(context.localTitle),
    normalizeForComparison(result.title),
  );
  const titleScore = titleSim * 50;

  // Author similarity — check against all result authors, take best
  let authorSim = 0;
  if (context.localAuthor) {
    const localNorm = normalizeForComparison(context.localAuthor);
    for (const ra of result.authors) {
      const sim = stringSimilarity(localNorm, normalizeForComparison(ra));
      if (sim > authorSim) authorSim = sim;
    }
  }
  const authorScore = context.localAuthor ? authorSim * 30 : 0;

  // Series bonus: +10 if local series matches result series
  let seriesBonus = 0;
  if (context.localSeries && result.series) {
    const seriesSim = stringSimilarity(
      normalizeForComparison(context.localSeries),
      normalizeForComparison(result.series),
    );
    if (seriesSim > 0.7) seriesBonus = 10;
  }

  // Index bonus: +5 if series matches AND positions equal
  let indexBonus = 0;
  if (seriesBonus > 0 && context.localSeriesPosition != null && result.seriesPosition != null) {
    if (context.localSeriesPosition === result.seriesPosition) indexBonus = 5;
  }

  // Format bonus: +5 placeholder (would need audiobook edition data from API)
  const formatBonus = 0;

  // Directory author bonus: +5 if dir author matches result author
  let dirAuthorBonus = 0;
  if (context.directoryAuthor) {
    const dirNorm = normalizeForComparison(context.directoryAuthor);
    for (const ra of result.authors) {
      if (stringSimilarity(dirNorm, normalizeForComparison(ra)) > 0.7) {
        dirAuthorBonus = 5;
        break;
      }
    }
  }

  // Author mismatch penalty: -30 if local author present but doesn't match ANY result author
  let authorPenalty = 0;
  if (context.localAuthor && result.authors.length > 0) {
    const localNorm = normalizeForComparison(context.localAuthor);
    const bestMatch = Math.max(...result.authors.map(ra =>
      stringSimilarity(localNorm, normalizeForComparison(ra)),
    ));
    if (bestMatch < 0.3) authorPenalty = -30;
  }

  const raw = titleScore + authorScore + seriesBonus + indexBonus + formatBonus + dirAuthorBonus + authorPenalty;
  const total = Math.max(0, Math.min(100, raw));

  return {
    titleScore,
    authorScore,
    seriesBonus,
    indexBonus,
    formatBonus,
    dirAuthorBonus,
    authorPenalty,
    total,
    // Legacy fields
    titleSimilarity: titleSim,
    authorSimilarity: authorSim,
    titleWeight: 0.5,
    authorWeight: 0.3,
    localTitle: context.localTitle,
    matchedTitle: result.title,
    localAuthor: context.localAuthor,
    matchedAuthor: result.authors[0] || null,
  };
}

/**
 * Match a single book against the metadata provider.
 * Pipeline: Corrections → ISBN → Title+Author → Title-only
 */
export async function matchBook(
  prov: MetadataProvider,
  title: string,
  author?: string,
  isbn?: string,
  context?: Partial<ScoringContext>,
): Promise<MetadataMatchResult | null> {
  // Step 0: Check correction table for previously-corrected titles
  try {
    const normalizedTitle = normalizeForComparison(title);
    const correction = db.select()
      .from(schema.matchCorrections)
      .where(eq(schema.matchCorrections.localTitle, normalizedTitle))
      .get();
    if (correction) {
      const details = await prov.getDetails(correction.matchedExternalId);
      if (details) {
        console.log(`[Metadata] Using stored correction for "${title}" → "${details.title}"`);
        return { ...details, confidence: 0.95, provider: prov.name };
      }
    }
  } catch {
    // matchCorrections table may not exist yet
  }

  // Step 1: Search by ISBN (highest confidence)
  if (isbn) {
    const results = await prov.searchByIsbn(isbn);
    const isbnMatch = results[0];
    if (isbnMatch) {
      return {
        ...isbnMatch,
        confidence: METADATA.HIGH_CONFIDENCE_THRESHOLD,
        provider: prov.name,
      };
    }
  }

  // Step 2: Search by title + author
  const results = await prov.searchByTitle(title, author);
  if (results.length === 0) return null;

  // Build scoring context
  const scoringCtx: ScoringContext = {
    localTitle: title,
    localAuthor: author || null,
    localSeries: context?.localSeries || null,
    localSeriesPosition: context?.localSeriesPosition ?? null,
    directoryAuthor: context?.directoryAuthor || null,
    isAudiobook: context?.isAudiobook || false,
  };

  // Score results with new point-based model
  const scored = results.map((result) => {
    const breakdown = scoreResult(result, scoringCtx);
    const confidence = breakdown.total / 100;

    return {
      ...result,
      confidence,
      provider: prov.name,
      matchBreakdown: breakdown,
    };
  });

  scored.sort((a, b) => b.confidence - a.confidence);

  // Log query and top results
  console.log(`[Metadata] Query: title="${title}" author="${author || ''}" → ${scored.length} results`);
  for (const s of scored.slice(0, 3)) {
    const bd = s.matchBreakdown;
    console.log(`[Metadata]   "${s.title}" by ${s.authors[0] || '?'}: title=${bd.titleScore.toFixed(0)}/50 author=${bd.authorScore.toFixed(0)}/30 series=${bd.seriesBonus} penalty=${bd.authorPenalty} → ${bd.total.toFixed(0)}/100`);
  }

  const best = scored[0];
  if (!best) return null;

  // Hard floor: reject if title score is too low
  const titleScoreNorm = best.matchBreakdown.titleScore / 50;
  if (titleScoreNorm < METADATA.TITLE_HARD_FLOOR) {
    console.log(`[Metadata] Rejected "${best.title}" — title score ${best.matchBreakdown.titleScore.toFixed(0)}/50 below hard floor`);
    return null;
  }

  // Title gate
  if (titleScoreNorm < METADATA.TITLE_GATE) {
    console.log(`[Metadata] Rejected "${best.title}" — title score ${best.matchBreakdown.titleScore.toFixed(0)}/50 below title gate`);
    return null;
  }

  // Reject below threshold
  if (best.confidence < METADATA.REJECT_THRESHOLD) {
    console.log(`[Metadata] Rejected "${best.title}" — total ${best.matchBreakdown.total.toFixed(0)}/100 below threshold ${METADATA.REJECT_THRESHOLD * 100}`);
    return null;
  }

  return best;
}

function isDirtyTitle(title: string, bookId: number): boolean {
  const authorRow = db
    .select({ name: schema.authors.name })
    .from(schema.bookAuthors)
    .innerJoin(schema.authors, eq(schema.bookAuthors.authorId, schema.authors.id))
    .where(eq(schema.bookAuthors.bookId, bookId))
    .get();

  const titleLower = title.toLowerCase().trim();
  const authorLower = (authorRow?.name || '').toLowerCase().trim();

  return (
    (authorLower !== '' && titleLower === authorLower) ||
    /\((?:azw3|epub|mobi|pdf|m4b|mp3)\)/i.test(title) ||
    /\(retail\)/i.test(title) ||
    /^\[.*?\]\s*-\s*/.test(title)
  );
}

/**
 * Build scoring context for a book by querying its series, files, and directory hints.
 */
function buildScoringContext(bookId: number, _searchTitle: string, _authorName: string | null): Partial<ScoringContext> {
  const ctx: Partial<ScoringContext> = {};

  // Get series info
  const bookSeriesRow = db
    .select({
      seriesName: schema.series.name,
      position: schema.bookSeries.position,
    })
    .from(schema.bookSeries)
    .innerJoin(schema.series, eq(schema.bookSeries.seriesId, schema.series.id))
    .where(eq(schema.bookSeries.bookId, bookId))
    .get();

  if (bookSeriesRow) {
    ctx.localSeries = bookSeriesRow.seriesName;
    ctx.localSeriesPosition = bookSeriesRow.position;
  }

  // Get file info for directory hint and format
  const file = db.select({ path: schema.files.path, format: schema.files.format })
    .from(schema.files)
    .where(eq(schema.files.bookId, bookId))
    .get();

  if (file) {
    const dirPath = file.path.replace(/[\\/][^\\/]+$/, '');
    ctx.directoryAuthor = getDirAuthorHint(dirPath);
    ctx.isAudiobook = ['m4b', 'mp3'].includes(file.format);

    // Also try to extract series from filename if not already set
    if (!ctx.localSeries) {
      const parsed = parseFilename(file.path.replace(/^.*[\\/]/, ''), dirPath);
      if (parsed.seriesName) {
        ctx.localSeries = parsed.seriesName;
        ctx.localSeriesPosition = parsed.seriesPosition;
      }
    }
  }

  return ctx;
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
  let searchTitle = cleanTitle(book.title);

  // When stored title is garbage (equals author name, has format artifacts, etc.),
  // extract a search title from the filename instead
  if (isDirtyTitle(book.title, bookId)) {
    const file = db.select({ path: schema.files.path, filename: schema.files.filename })
      .from(schema.files)
      .where(eq(schema.files.bookId, bookId))
      .get();
    if (file) {
      const dirPath = file.path.replace(/[\\/][^\\/]+$/, '');
      const parsed = parseFilename(file.filename, dirPath);
      const fileTitle = cleanTitle(parsed.title);
      if (fileTitle.toLowerCase() !== (authorRow?.name || '').toLowerCase()) {
        searchTitle = fileTitle;
        console.log(`[Metadata] Using filename title "${searchTitle}" instead of dirty "${book.title}"`);
      }
    }
  }

  ensureToken();

  // Build scoring context with series, directory, and format info
  const scoringCtx = buildScoringContext(bookId, searchTitle, authorRow?.name || null);

  const match = await matchBook(provider, searchTitle, authorRow?.name, isbn, scoringCtx);

  if (!match) {
    console.log(`[Metadata] No match found for "${book.title}"`);
    return;
  }

  console.log(`[Metadata] Matched "${book.title}" -> "${match.title}" (${(match.confidence * 100).toFixed(0)}% confidence)`);

  // If we matched via search (no slug), fetch details to get slug + all series
  let slug = match.slug;
  let allSeries = match.allSeries;
  let canonicalTitle = match.title;
  if (!slug) {
    const details = await provider.getDetails(match.externalId);
    if (details) {
      slug = details.slug;
      allSeries = details.allSeries;
      if (details.title) canonicalTitle = details.title;
    }
  }

  // Determine needs_review flag based on confidence
  const needsReview = match.confidence >= METADATA.ACCEPT_THRESHOLD ? 0 : 1;

  // Update book metadata
  const updates: Record<string, any> = {
    hardcoverId: match.externalId,
    hardcoverSlug: slug || null,
    matchConfidence: match.confidence,
    matchBreakdown: (match as any).matchBreakdown ? JSON.stringify((match as any).matchBreakdown) : null,
    needsReview,
    updatedAt: new Date().toISOString(),
  };

  // Only overwrite fields that are currently empty
  if (!book.description && match.description) updates.description = match.description;
  if (!book.publishDate && match.publishDate) updates.publishDate = match.publishDate;
  if (!book.isbn13 && match.isbn13) updates.isbn13 = match.isbn13;
  if (!book.pageCount && match.pageCount) updates.pageCount = match.pageCount;
  if (!book.isbn10 && match.isbn10) updates.isbn10 = match.isbn10;

  // Use canonical title (from books_by_pk) when fixing dirty titles
  if (canonicalTitle && isDirtyTitle(book.title, bookId)) {
    updates.title = canonicalTitle;
    console.log(`[Metadata] Fixed title "${book.title}" -> "${canonicalTitle}"`);
  }

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
        seriesRow ??= db.insert(schema.series).values({ name: s.name, hardcoverId: s.seriesId || null }).returning().get();
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
      seriesRow ??= db.insert(schema.series).values({ name: match.series }).returning().get();
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
      tag ??= db.insert(schema.tags).values({ name: tagName, source: 'hardcover' }).returning().get();
      db.insert(schema.bookTags)
        .values({ bookId, tagId: tag.id })
        .onConflictDoNothing()
        .run();
    }
  }
}

/**
 * Batch match all unmatched books.
 * Deduplicates queries: books sharing the same normalized title+author search once.
 */
export async function enrichAllUnmatched(): Promise<{ matched: number; total: number }> {
  const unmatched = db
    .select({ id: schema.books.id })
    .from(schema.books)
    .where(isNull(schema.books.hardcoverId))
    .all();

  let matched = 0;
  const seen = new Map<string, number>(); // normalized key → matched bookId (for dedup)

  for (const book of unmatched) {
    try {
      // Build dedup key
      const bookRow = db.select({ title: schema.books.title }).from(schema.books).where(eq(schema.books.id, book.id)).get();
      const authorRow = db
        .select({ name: schema.authors.name })
        .from(schema.bookAuthors)
        .innerJoin(schema.authors, eq(schema.bookAuthors.authorId, schema.authors.id))
        .where(eq(schema.bookAuthors.bookId, book.id))
        .get();
      const key = normalizeForComparison(cleanTitle(bookRow?.title || '')) + '|' + normalizeForComparison(authorRow?.name || '');

      if (seen.has(key)) {
        // Copy match from previously matched book with same title+author
        const sourceId = seen.get(key)!;
        const source = db.select({ hardcoverId: schema.books.hardcoverId }).from(schema.books).where(eq(schema.books.id, sourceId)).get();
        if (source?.hardcoverId) {
          console.log(`[Metadata] Dedup: book ${book.id} shares key with ${sourceId}, skipping API call`);
        }
      }

      await enrichBook(book.id);
      // Check if it was matched
      const updated = db.select({ hardcoverId: schema.books.hardcoverId }).from(schema.books).where(eq(schema.books.id, book.id)).get();
      if (updated?.hardcoverId) {
        matched++;
        seen.set(key, book.id);
      }
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
 * Also stores the correction for future auto-matching.
 */
export async function applyMatch(bookId: number, externalId: string): Promise<void> {
  ensureToken();
  const details = await provider.getDetails(externalId);
  if (!details) return;

  const book = db.select().from(schema.books).where(eq(schema.books.id, bookId)).get();

  const updates: Record<string, any> = {
    hardcoverId: externalId,
    hardcoverSlug: details.slug || null,
    matchConfidence: 1,
    needsReview: 0,
    updatedAt: new Date().toISOString(),
  };

  if (details.title) updates.title = details.title;
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
      seriesRow ??= db.insert(schema.series).values({ name: s.name, hardcoverId: s.seriesId || null }).returning().get();
      db.insert(schema.bookSeries)
        .values({ bookId, seriesId: seriesRow.id, position: s.position })
        .onConflictDoNothing()
        .run();
    }
  }

  // Store correction for future auto-matching
  if (book) {
    try {
      const normalizedTitle = normalizeForComparison(book.title);
      const authorRow = db
        .select({ name: schema.authors.name })
        .from(schema.bookAuthors)
        .innerJoin(schema.authors, eq(schema.bookAuthors.authorId, schema.authors.id))
        .where(eq(schema.bookAuthors.bookId, bookId))
        .get();

      db.insert(schema.matchCorrections)
        .values({
          localTitle: normalizedTitle,
          localAuthor: authorRow?.name || null,
          matchedExternalId: externalId,
          matchedTitle: details.title,
          matchedAuthor: details.authors[0] || null,
        })
        .onConflictDoNothing()
        .run();
    } catch {
      // matchCorrections table may not exist yet
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
      tag ??= db.insert(schema.tags).values({ name: tagName, source: 'hardcover' }).returning().get();
      db.insert(schema.bookTags)
        .values({ bookId, tagId: tag.id })
        .onConflictDoNothing()
        .run();
    }
  }
}

/**
 * Bulk cleanup: fix dirty titles on books that already have a Hardcover match.
 * Re-fetches the correct title from Hardcover for each dirty book.
 */
export async function cleanupDirtyTitles(): Promise<{ fixed: number; total: number }> {
  // Phase 1: Fix matched books by fetching canonical title from Hardcover
  const matched = db
    .select({
      id: schema.books.id,
      title: schema.books.title,
      hardcoverId: schema.books.hardcoverId,
    })
    .from(schema.books)
    .where(isNotNull(schema.books.hardcoverId))
    .all();

  let fixed = 0;
  for (const book of matched) {
    if (!isDirtyTitle(book.title, book.id)) continue;

    try {
      ensureToken();
      const details = await provider.getDetails(book.hardcoverId!);
      if (!details?.title) continue;

      db.update(schema.books)
        .set({ title: details.title, updatedAt: new Date().toISOString() })
        .where(eq(schema.books.id, book.id))
        .run();
      console.log(`[Cleanup] Fixed title: "${book.title}" -> "${details.title}"`);
      fixed++;
    } catch (err) {
      console.error(`[Cleanup] Error fixing title for book ${book.id}:`, err);
    }
  }

  // Phase 2: Fix unmatched dirty books using filename, then re-queue enrichment
  const unmatchedBooks = db
    .select({
      id: schema.books.id,
      title: schema.books.title,
    })
    .from(schema.books)
    .where(isNull(schema.books.hardcoverId))
    .all();

  for (const book of unmatchedBooks) {
    if (!isDirtyTitle(book.title, book.id)) continue;

    const file = db.select({ path: schema.files.path, filename: schema.files.filename })
      .from(schema.files)
      .where(eq(schema.files.bookId, book.id))
      .get();
    if (!file) continue;

    const dirPath = file.path.replace(/[\\/][^\\/]+$/, '');
    const parsed = parseFilename(file.filename, dirPath);
    const fileTitle = cleanTitle(parsed.title);

    if (fileTitle && fileTitle.toLowerCase() !== book.title.toLowerCase()) {
      db.update(schema.books)
        .set({ title: fileTitle, updatedAt: new Date().toISOString() })
        .where(eq(schema.books.id, book.id))
        .run();
      console.log(`[Cleanup] Fixed unmatched title: "${book.title}" -> "${fileTitle}"`);
      fixed++;

      // Re-queue metadata matching for this book
      try {
        db.insert(schema.jobQueue).values({
          jobType: 'match_metadata',
          payload: JSON.stringify({ bookId: book.id }),
        }).run();
      } catch { /* ignore duplicate queue entries */ }
    }
  }

  return { fixed, total: matched.length + unmatchedBooks.filter(b => isDirtyTitle(b.title, b.id)).length };
}

/**
 * Enrich local author records with bio and photo from Hardcover.
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

      const authorUpdates: Record<string, string> = {};
      if (!localAuthor.bio && details.bio) authorUpdates.bio = details.bio;
      if (!localAuthor.photoUrl && details.imageUrl) authorUpdates.photoUrl = details.imageUrl;

      if (Object.keys(authorUpdates).length > 0) {
        db.update(schema.authors)
          .set(authorUpdates)
          .where(eq(schema.authors.id, localAuthor.authorId))
          .run();
        console.log(`[Metadata] Enriched author "${localAuthor.name}" with ${Object.keys(authorUpdates).join(', ')}`);
      }
    } catch (err) {
      console.warn(`[Metadata] Failed to enrich author "${localAuthor.name}":`, err);
    }
  }
}
