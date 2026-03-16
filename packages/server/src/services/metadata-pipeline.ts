import { eq, isNull, isNotNull } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import type { MetadataProvider } from '../providers/metadata-provider.js';
import type { MetadataMatchResult, MetadataSearchResult } from '@npc-shelf/shared';
import { METADATA } from '@npc-shelf/shared';
import { stringSimilarity, normalizeForComparison } from '../utils/string-similarity.js';
import { cleanTitle, parseFilename, getDirAuthorHint } from '../utils/filename-parser.js';
import { downloadAndResizeCover } from './cover.js';
import { HardcoverProvider } from '../providers/hardcover.js';
import { sanitizeDescription } from '../utils/sanitize-html.js';

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

function bestAuthorSimilarity(localAuthor: string, resultAuthors: string[]): number {
  const localNorm = normalizeForComparison(localAuthor);
  let best = 0;
  for (const ra of resultAuthors) {
    const sim = stringSimilarity(localNorm, normalizeForComparison(ra));
    if (sim > best) best = sim;
  }
  return best;
}

export function scoreResult(result: MetadataSearchResult, context: ScoringContext): ScoreBreakdown {
  const titleSim = stringSimilarity(
    normalizeForComparison(context.localTitle),
    normalizeForComparison(result.title),
  );
  const titleScore = titleSim * 50;

  const authorSim = context.localAuthor
    ? bestAuthorSimilarity(context.localAuthor, result.authors)
    : 0;
  const authorScore = context.localAuthor ? authorSim * 30 : 0;

  const seriesBonus = (context.localSeries && result.series &&
    stringSimilarity(normalizeForComparison(context.localSeries), normalizeForComparison(result.series)) > 0.7)
    ? 10 : 0;

  const indexBonus = (seriesBonus > 0 && context.localSeriesPosition != null &&
    result.seriesPosition != null && context.localSeriesPosition === result.seriesPosition)
    ? 5 : 0;

  const formatBonus = 0;

  const dirAuthorBonus = context.directoryAuthor
    ? (bestAuthorSimilarity(context.directoryAuthor, result.authors) > 0.7 ? 5 : 0)
    : 0;

  const authorPenalty = (context.localAuthor && result.authors.length > 0 &&
    bestAuthorSimilarity(context.localAuthor, result.authors) < 0.3)
    ? -30 : 0;

  const raw = titleScore + authorScore + seriesBonus + indexBonus + formatBonus + dirAuthorBonus + authorPenalty;
  const total = Math.max(0, Math.min(100, raw));

  return {
    titleScore, authorScore, seriesBonus, indexBonus, formatBonus, dirAuthorBonus, authorPenalty, total,
    titleSimilarity: titleSim, authorSimilarity: authorSim,
    titleWeight: 0.5, authorWeight: 0.3,
    localTitle: context.localTitle, matchedTitle: result.title,
    localAuthor: context.localAuthor, matchedAuthor: result.authors[0] || null,
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
    /^\[[^\]]{0,200}\]\s*-\s*/.test(title)
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

function resolveSearchTitle(book: { title: string; isbn13: string | null; isbn10: string | null }, bookId: number, authorName: string | null): string {
  let searchTitle = cleanTitle(book.title);
  if (isDirtyTitle(book.title, bookId)) {
    const file = db.select({ path: schema.files.path, filename: schema.files.filename })
      .from(schema.files)
      .where(eq(schema.files.bookId, bookId))
      .get();
    if (file) {
      const dirPath = file.path.replace(/[\\/][^\\/]+$/, '');
      const parsed = parseFilename(file.filename, dirPath);
      const fileTitle = cleanTitle(parsed.title);
      if (fileTitle.toLowerCase() !== (authorName || '').toLowerCase()) {
        searchTitle = fileTitle;
        console.log(`[Metadata] Using filename title "${searchTitle}" instead of dirty "${book.title}"`);
      }
    }
  }
  return searchTitle;
}

async function syncSeriesFromMatch(
  bookId: number,
  allSeries: MetadataSearchResult['allSeries'] | null | undefined,
  fallbackSeries: string | null | undefined,
  fallbackPosition: number | null | undefined,
): Promise<void> {
  const existingSeries = db.select().from(schema.bookSeries).where(eq(schema.bookSeries.bookId, bookId)).get();
  if (existingSeries) return;

  if (allSeries && allSeries.length > 0) {
    for (const s of allSeries) {
      let seriesRow = db.select().from(schema.series).where(eq(schema.series.name, s.name)).get();
      seriesRow ??= db.insert(schema.series).values({ name: s.name, hardcoverId: s.seriesId || null }).returning().get();
      db.insert(schema.bookSeries)
        .values({ bookId, seriesId: seriesRow.id, position: s.position })
        .onConflictDoNothing()
        .run();

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
  } else if (fallbackSeries) {
    let seriesRow = db.select().from(schema.series).where(eq(schema.series.name, fallbackSeries)).get();
    seriesRow ??= db.insert(schema.series).values({ name: fallbackSeries }).returning().get();
    db.insert(schema.bookSeries)
      .values({ bookId, seriesId: seriesRow.id, position: fallbackPosition ?? null })
      .onConflictDoNothing()
      .run();
  }
}

function syncTagsFromMatch(bookId: number, tags: string[] | null | undefined): void {
  if (!tags || tags.length === 0) return;
  for (const tagName of tags) {
    let tag = db.select().from(schema.tags).where(eq(schema.tags.name, tagName)).get();
    tag ??= db.insert(schema.tags).values({ name: tagName, source: 'hardcover' }).returning().get();
    db.insert(schema.bookTags)
      .values({ bookId, tagId: tag.id })
      .onConflictDoNothing()
      .run();
  }
}

function cacheMatchResult(bookId: number, providerName: string, externalId: string, data: object): void {
  db.insert(schema.metadataCache)
    .values({
      bookId,
      provider: providerName,
      externalId,
      rawData: JSON.stringify(data),
      fetchedAt: new Date().toISOString(),
    })
    .onConflictDoNothing()
    .run();
}

/**
 * Match and enrich a single book by its database ID.
 * Downloads cover and updates all metadata.
 */
export async function enrichBook(bookId: number): Promise<void> {
  const book = db.select().from(schema.books).where(eq(schema.books.id, bookId)).get();
  if (!book) return;

  const authorRow = db
    .select({ name: schema.authors.name })
    .from(schema.bookAuthors)
    .innerJoin(schema.authors, eq(schema.bookAuthors.authorId, schema.authors.id))
    .where(eq(schema.bookAuthors.bookId, bookId))
    .get();

  const isbn = book.isbn13 || book.isbn10 || undefined;
  const searchTitle = resolveSearchTitle(book, bookId, authorRow?.name || null);

  ensureToken();
  const scoringCtx = buildScoringContext(bookId, searchTitle, authorRow?.name || null);
  const match = await matchBook(provider, searchTitle, authorRow?.name, isbn, scoringCtx);

  if (!match) {
    console.log(`[Metadata] No match found for "${book.title}"`);
    return;
  }

  console.log(`[Metadata] Matched "${book.title}" -> "${match.title}" (${(match.confidence * 100).toFixed(0)}% confidence)`);

  // Fetch details for slug + allSeries if not present
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

  const needsReview = match.confidence >= METADATA.ACCEPT_THRESHOLD ? 0 : 1;
  const updates: Record<string, any> = {
    hardcoverId: match.externalId,
    hardcoverSlug: slug || null,
    matchConfidence: match.confidence,
    matchBreakdown: (match as any).matchBreakdown ? JSON.stringify((match as any).matchBreakdown) : null,
    needsReview,
    updatedAt: new Date().toISOString(),
  };

  if (!book.description && match.description) updates.description = sanitizeDescription(match.description);
  if (!book.publishDate && match.publishDate) updates.publishDate = match.publishDate;
  if (!book.isbn13 && match.isbn13) updates.isbn13 = match.isbn13;
  if (!book.pageCount && match.pageCount) updates.pageCount = match.pageCount;
  if (!book.isbn10 && match.isbn10) updates.isbn10 = match.isbn10;

  if (canonicalTitle && isDirtyTitle(book.title, bookId)) {
    updates.title = canonicalTitle;
    console.log(`[Metadata] Fixed title "${book.title}" -> "${canonicalTitle}"`);
  }

  db.update(schema.books).set(updates).where(eq(schema.books.id, bookId)).run();

  if (!book.coverPath && match.coverUrl) {
    const coverPath = await downloadAndResizeCover(match.coverUrl, bookId);
    if (coverPath) {
      db.update(schema.books).set({ coverPath }).where(eq(schema.books.id, bookId)).run();
    }
  }

  await syncSeriesFromMatch(bookId, allSeries, match.series, match.seriesPosition);
  await enrichAuthorsFromMatch(bookId);
  cacheMatchResult(bookId, match.provider, match.externalId, match);
  syncTagsFromMatch(bookId, match.tags);
}

/**
 * Batch match all unmatched books.
 * When force=true, clears all existing matches first and re-scores everything.
 * Deduplicates queries: books sharing the same normalized title+author search once.
 */
export async function enrichAllUnmatched(force = false): Promise<{ matched: number; total: number }> {
  if (force) {
    // Clear all existing metadata matches so everything gets re-scored
    const allMatched = db
      .select({ id: schema.books.id })
      .from(schema.books)
      .where(isNotNull(schema.books.hardcoverId))
      .all();
    console.log(`[Metadata] Force mode: clearing ${allMatched.length} existing matches`);
    for (const book of allMatched) {
      db.update(schema.books).set({
        hardcoverId: null,
        hardcoverSlug: null,
        matchConfidence: null,
        matchBreakdown: null,
        needsReview: 0,
      }).where(eq(schema.books.id, book.id)).run();
    }
    // Also clear metadata cache so we get fresh data
    db.delete(schema.metadataCache).run();
  }

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
  if (details.description) updates.description = sanitizeDescription(details.description);
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

  await syncSeriesFromMatch(bookId, details.allSeries, null, null);
  storeCorrection(book, bookId, externalId, details);
  cacheMatchResult(bookId, provider.name, externalId, details);
  syncTagsFromMatch(bookId, details.tags);
}

function storeCorrection(
  book: { title: string } | undefined,
  bookId: number,
  externalId: string,
  details: { title: string; authors: string[] },
): void {
  if (!book) return;
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
