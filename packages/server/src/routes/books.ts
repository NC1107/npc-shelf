import { Router } from 'express';
import { eq, desc, asc, inArray, sql } from 'drizzle-orm';
import { db, schema, sqlite } from '../db/index.js';
import fs from 'node:fs';
import multer from 'multer';
import { extractAndCacheCover } from '../services/cover.js';
import { detectDuplicates } from '../services/duplicate-detector.js';
import { enqueueJob } from '../services/job-queue.js';
import { isConvertAvailable, SUPPORTED_CONVERSIONS } from '../services/format-converter.js';
import { enrichBooksWithMeta } from '../utils/book-enricher.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

export const booksRouter = Router();

// Library stats
booksRouter.get('/stats', (_req, res) => {
  try {
    const totalBooks = db.all<{ count: number }>(
      sql`SELECT COUNT(DISTINCT book_id) as count FROM files`,
    )[0]?.count ?? 0;
    const totalAuthors = db.select({ count: sql<number>`count(*)` }).from(schema.authors).get()!.count;

    // Count ebooks vs audiobooks by checking files
    const ebookCount = db
      .all<{ count: number }>(
        sql`SELECT COUNT(DISTINCT book_id) as count FROM files WHERE format IN ('epub', 'pdf', 'mobi', 'azw3')`,
      )[0]?.count ?? 0;

    const audiobookCount = db
      .all<{ count: number }>(
        sql`SELECT COUNT(DISTINCT book_id) as count FROM files WHERE format IN ('m4b', 'mp3')`,
      )[0]?.count ?? 0;

    // In-progress books (reading or listening)
    const userId = _req.user!.userId;
    const readingCount = db
      .all<{ count: number }>(
        sql`SELECT COUNT(*) as count FROM reading_progress WHERE user_id = ${userId} AND progress_percent > 0 AND progress_percent < 1`,
      )[0]?.count ?? 0;

    const listeningCount = db
      .all<{ count: number }>(
        sql`SELECT COUNT(*) as count FROM audio_progress WHERE user_id = ${userId} AND is_finished = 0 AND total_elapsed_seconds > 0`,
      )[0]?.count ?? 0;

    res.json({
      totalBooks,
      totalAuthors,
      ebookCount,
      audiobookCount,
      inProgress: readingCount + listeningCount,
    });
  } catch (error) {
    console.error('[Books] Stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// List books (paginated, filterable, searchable)
booksRouter.get('/', (req, res) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(req.query.pageSize as string) || 24));
    const sortBy = (req.query.sortBy as string) || 'title';
    const sortOrder = (req.query.sortOrder as string) === 'desc' ? 'desc' : 'asc';
    const q = req.query.q as string | undefined;
    const format = req.query.format as string | undefined;
    const authorId = req.query.authorId as string | undefined;
    const seriesId = req.query.seriesId as string | undefined;

    let bookIds: number[] | undefined;

    // FTS5 search — transform multi-word queries for proper FTS5 syntax
    if (q) {
      try {
        const ftsQuery = q.trim().split(/\s+/).map(word => `"${word}"*`).join(' ');
        const ftsResults = db
          .all<{ rowid: number }>(
            sql`SELECT rowid FROM books_fts WHERE books_fts MATCH ${ftsQuery} ORDER BY rank LIMIT 1000`,
          );
        bookIds = ftsResults.map((r) => r.rowid);
      } catch (ftsErr) {
        console.warn('[Books] FTS5 query failed:', ftsErr);
        bookIds = [];
      }
      if (bookIds.length === 0) {
        res.json({ items: [], total: 0, page, pageSize, totalPages: 0 });
        return;
      }
    }

    // Filter by format
    if (format) {
      const fileResults = db
        .selectDistinct({ bookId: schema.files.bookId })
        .from(schema.files)
        .where(eq(schema.files.format, format as 'epub' | 'pdf' | 'mobi' | 'azw3' | 'm4b' | 'mp3'))
        .all();
      const formatBookIds = fileResults.map((r) => r.bookId);
      bookIds = bookIds
        ? bookIds.filter((id) => formatBookIds.includes(id))
        : formatBookIds;
    }

    // Filter by author
    if (authorId) {
      const authorResults = db
        .select({ bookId: schema.bookAuthors.bookId })
        .from(schema.bookAuthors)
        .where(eq(schema.bookAuthors.authorId, Number.parseInt(authorId)))
        .all();
      const authorBookIds = authorResults.map((r) => r.bookId);
      bookIds = bookIds
        ? bookIds.filter((id) => authorBookIds.includes(id))
        : authorBookIds;
    }

    // Filter by series
    if (seriesId) {
      const seriesResults = db
        .select({ bookId: schema.bookSeries.bookId })
        .from(schema.bookSeries)
        .where(eq(schema.bookSeries.seriesId, Number.parseInt(seriesId)))
        .all();
      const seriesBookIds = seriesResults.map((r) => r.bookId);
      bookIds = bookIds
        ? bookIds.filter((id) => seriesBookIds.includes(id))
        : seriesBookIds;
    }

    // Default: only show books that have at least one file
    if (bookIds === undefined) {
      const booksWithFiles = db
        .all<{ book_id: number }>(
          sql`SELECT DISTINCT book_id FROM files`,
        );
      bookIds = booksWithFiles.map(r => r.book_id);
    }

    // Build query
    let query = db.select().from(schema.books).$dynamic();

    if (bookIds !== undefined) {
      if (bookIds.length === 0) {
        res.json({ items: [], total: 0, page, pageSize, totalPages: 0 });
        return;
      }
      query = query.where(inArray(schema.books.id, bookIds));
    }

    // Count total
    const countResult = bookIds === undefined
      ? db.select({ count: sql<number>`count(*)` }).from(schema.books).get()!
      : { count: bookIds.length };
    const total = countResult.count;
    const totalPages = Math.ceil(total / pageSize);

    // Sort
    const sortColumnsMap: Record<string, any> = {
      createdAt: schema.books.createdAt,
      updatedAt: schema.books.updatedAt,
    };
    const orderColumn = sortColumnsMap[sortBy as string] ?? schema.books.title;
    const orderFn = sortOrder === 'desc' ? desc : asc;

    const rawItems = query
      .orderBy(orderFn(orderColumn))
      .limit(pageSize)
      .offset((page - 1) * pageSize)
      .all();

    // Enrich with authors and formats for BookCard display
    const items = enrichBooksWithMeta(rawItems);

    res.json({ items, total, page, pageSize, totalPages });
  } catch (error) {
    console.error('[Books] List error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Filter options (for sidebar)
booksRouter.get('/filters', (_req, res) => {
  try {
    const authors = db
      .select({ id: schema.authors.id, name: schema.authors.name })
      .from(schema.authors)
      .orderBy(asc(schema.authors.sortName))
      .all();

    const seriesList = db
      .select({ id: schema.series.id, name: schema.series.name })
      .from(schema.series)
      .orderBy(asc(schema.series.name))
      .all();

    const formats = db
      .selectDistinct({ format: schema.files.format })
      .from(schema.files)
      .all()
      .map((f) => f.format);

    res.json({ authors, series: seriesList, formats });
  } catch (error) {
    console.error('[Books] Filters error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get book detail
booksRouter.get('/:id', (req, res) => {
  try {
    const bookId = Number.parseInt(req.params.id);
    if (Number.isNaN(bookId)) { res.status(400).json({ error: 'Invalid book ID' }); return; }
    const book = db.select().from(schema.books).where(eq(schema.books.id, bookId)).get();
    if (!book) {
      res.status(404).json({ error: 'Book not found' });
      return;
    }

    // Get authors
    const bookAuthorRows = db
      .select()
      .from(schema.bookAuthors)
      .innerJoin(schema.authors, eq(schema.bookAuthors.authorId, schema.authors.id))
      .where(eq(schema.bookAuthors.bookId, bookId))
      .all();
    const authors = bookAuthorRows.map((row) => ({
      author: row.authors,
      role: row.book_authors.role,
    }));

    // Get series
    const bookSeriesRows = db
      .select()
      .from(schema.bookSeries)
      .innerJoin(schema.series, eq(schema.bookSeries.seriesId, schema.series.id))
      .where(eq(schema.bookSeries.bookId, bookId))
      .all();
    const seriesList = bookSeriesRows.map((row) => ({
      series: row.series,
      position: row.book_series.position,
    }));

    // Get files
    const files = db
      .select()
      .from(schema.files)
      .where(eq(schema.files.bookId, bookId))
      .all();

    // Get tags
    const bookTagRows = db
      .select()
      .from(schema.bookTags)
      .innerJoin(schema.tags, eq(schema.bookTags.tagId, schema.tags.id))
      .where(eq(schema.bookTags.bookId, bookId))
      .all();
    const tags = bookTagRows.map((row) => row.tags);

    // Get reading progress
    const userId = req.user!.userId;
    const readingProgress = db
      .select()
      .from(schema.readingProgress)
      .where(
        sql`${schema.readingProgress.userId} = ${userId} AND ${schema.readingProgress.bookId} = ${bookId}`,
      )
      .get() || null;

    const audioProgress = db
      .select()
      .from(schema.audioProgress)
      .where(
        sql`${schema.audioProgress.userId} = ${userId} AND ${schema.audioProgress.bookId} = ${bookId}`,
      )
      .get() || null;

    // Compute total audio duration from tracks if not on the book record
    let audioTotalDuration = book.audioSeconds || 0;
    if (!audioTotalDuration) {
      const tracks = db.select().from(schema.audioTracks)
        .where(eq(schema.audioTracks.bookId, bookId)).all();
      audioTotalDuration = tracks.reduce((sum, t) => sum + t.durationSeconds, 0);
    }

    // Count audio tracks for display
    const audioTrackCount = db
      .select({ count: sql<number>`count(*)` })
      .from(schema.audioTracks)
      .where(eq(schema.audioTracks.bookId, bookId))
      .get()!.count;

    // Determine format flags
    const hasEbook = files.some((f: any) => ['epub', 'pdf', 'mobi', 'azw3'].includes(f.format));
    const hasAudio = files.some((f: any) => ['m4b', 'mp3'].includes(f.format));

    // Parse match breakdown JSON
    let matchBreakdown = null;
    if (book.matchBreakdown) {
      try { matchBreakdown = JSON.parse(book.matchBreakdown); } catch { /* ignore */ }
    }

    res.json({
      ...book,
      authors,
      series: seriesList,
      files,
      tags,
      readingProgress,
      audioProgress,
      audioTotalDuration,
      audioTrackCount,
      hasEbook,
      hasAudio,
      matchBreakdown,
    });
  } catch (error) {
    console.error('[Books] Detail error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get cover image
booksRouter.get('/:id/cover/:size', (req, res) => {
  try {
    const bookId = Number.parseInt(req.params.id);
    if (Number.isNaN(bookId)) { res.status(400).json({ error: 'Invalid book ID' }); return; }
    const size = req.params.size as 'thumb' | 'medium' | 'full';
    if (!['thumb', 'medium', 'full'].includes(size)) {
      res.status(400).json({ error: 'Invalid size. Use thumb, medium, or full' });
      return;
    }

    const book = db.select({ coverPath: schema.books.coverPath }).from(schema.books).where(eq(schema.books.id, bookId)).get();
    if (!book?.coverPath) {
      res.status(404).json({ error: 'No cover available' });
      return;
    }

    const coverDir = process.env.COVER_CACHE_PATH || './cache/covers';
    const coverFile = `${coverDir}/${bookId}_${size}.webp`;

    res.setHeader('Cache-Control', 'public, max-age=86400');

    if (fs.existsSync(coverFile)) {
      res.setHeader('Content-Type', 'image/webp');
      res.sendFile(coverFile, { root: process.cwd() });
    } else if (book.coverPath && fs.existsSync(book.coverPath)) {
      // Fallback to original
      res.sendFile(book.coverPath, { root: process.cwd() });
    } else {
      res.status(404).json({ error: 'Cover not found' });
    }
  } catch (error) {
    console.error('[Books] Cover error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Upload custom cover image
booksRouter.post('/:id/cover', upload.single('cover'), async (req, res) => {
  try {
    const bookId = Number.parseInt(req.params.id as string);
    if (Number.isNaN(bookId)) { res.status(400).json({ error: 'Invalid book ID' }); return; }

    const book = db.select().from(schema.books).where(eq(schema.books.id, bookId)).get();
    if (!book) { res.status(404).json({ error: 'Book not found' }); return; }

    if (!req.file) { res.status(400).json({ error: 'No image file uploaded' }); return; }

    const coverPath = await extractAndCacheCover(req.file.buffer, bookId);
    if (!coverPath) {
      res.status(400).json({ error: 'Invalid or unsupported image format' });
      return;
    }

    db.update(schema.books)
      .set({ coverPath, updatedAt: new Date().toISOString() })
      .where(eq(schema.books.id, bookId))
      .run();

    res.json({ message: 'Cover uploaded', coverPath });
  } catch (error) {
    console.error('[Books] Cover upload error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Download book file
booksRouter.get('/:id/file', (req, res) => {
  try {
    const bookId = Number.parseInt(req.params.id);
    if (Number.isNaN(bookId)) { res.status(400).json({ error: 'Invalid book ID' }); return; }
    const formatPref = req.query.format as string | undefined;

    let file;
    if (formatPref) {
      file = db.select().from(schema.files)
        .where(sql`${schema.files.bookId} = ${bookId} AND ${schema.files.format} = ${formatPref}`)
        .get();
    }
    file ??= db.select().from(schema.files).where(eq(schema.files.bookId, bookId)).get();

    if (!file) {
      res.status(404).json({ error: 'No file found' });
      return;
    }

    if (!fs.existsSync(file.path)) {
      res.status(404).json({ error: 'File not found on disk' });
      return;
    }

    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.sendFile(file.path);
  } catch (error) {
    console.error('[Books] File download error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update book metadata (including authors and series)
booksRouter.put('/:id', (req, res) => {
  try {
    const bookId = Number.parseInt(req.params.id);
    if (Number.isNaN(bookId)) { res.status(400).json({ error: 'Invalid book ID' }); return; }
    const book = db.select().from(schema.books).where(eq(schema.books.id, bookId)).get();
    if (!book) { res.status(404).json({ error: 'Book not found' }); return; }

    const allowedFields = [
      'title', 'subtitle', 'description', 'publisher',
      'publishDate', 'language', 'pageCount', 'isbn10', 'isbn13',
    ] as const;

    const updates: Record<string, any> = { updatedAt: new Date().toISOString() };
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    db.update(schema.books).set(updates).where(eq(schema.books.id, bookId)).run();

    // Update authors if provided: { authors: [{ name: string, role?: string }] }
    if (req.body.authors && Array.isArray(req.body.authors)) {
      // Remove existing author links
      db.delete(schema.bookAuthors).where(eq(schema.bookAuthors.bookId, bookId)).run();

      for (const a of req.body.authors as { name: string; role?: string }[]) {
        if (!a.name?.trim()) continue;
        const name = a.name.trim();
        const role = a.role || 'author';

        // Find or create author
        let authorRow = db.select().from(schema.authors).where(eq(schema.authors.name, name)).get();
        if (!authorRow) {
          const parts = name.split(/\s+/);
          const sortName = parts.length > 1 ? `${parts.at(-1)}, ${parts.slice(0, -1).join(' ')}` : name;
          authorRow = db.insert(schema.authors).values({ name, sortName }).returning().get();
        }

        db.insert(schema.bookAuthors)
          .values({ bookId, authorId: authorRow.id, role: role as 'author' | 'narrator' | 'editor' })
          .onConflictDoNothing()
          .run();
      }
    }

    // Update series if provided: { series: [{ name: string, position?: number }] }
    if (req.body.series && Array.isArray(req.body.series)) {
      // Remove existing series links
      db.delete(schema.bookSeries).where(eq(schema.bookSeries.bookId, bookId)).run();

      for (const s of req.body.series as { name: string; position?: number }[]) {
        if (!s.name?.trim()) continue;
        const name = s.name.trim();

        // Find or create series
        let seriesRow = db.select().from(schema.series).where(eq(schema.series.name, name)).get();
        seriesRow ??= db.insert(schema.series).values({ name }).returning().get();

        db.insert(schema.bookSeries)
          .values({ bookId, seriesId: seriesRow.id, position: s.position ?? null })
          .onConflictDoNothing()
          .run();
      }
    }

    const updated = db.select().from(schema.books).where(eq(schema.books.id, bookId)).get();
    res.json(updated);
  } catch (error) {
    console.error('[Books] Update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Split files from a book into a new book
booksRouter.post('/:id/split', (req, res) => {
  try {
    const bookId = Number.parseInt(req.params.id);
    if (Number.isNaN(bookId)) { res.status(400).json({ error: 'Invalid book ID' }); return; }

    const { fileIds } = req.body as { fileIds?: number[] };
    if (!fileIds || !Array.isArray(fileIds) || fileIds.length === 0) {
      res.status(400).json({ error: 'fileIds array is required' });
      return;
    }

    const book = db.select().from(schema.books).where(eq(schema.books.id, bookId)).get();
    if (!book) { res.status(404).json({ error: 'Book not found' }); return; }

    // Verify all fileIds belong to this book
    const allFiles = db.select().from(schema.files).where(eq(schema.files.bookId, bookId)).all();
    const allFileIds = new Set(allFiles.map(f => f.id));
    const invalidIds = fileIds.filter(id => !allFileIds.has(id));
    if (invalidIds.length > 0) {
      res.status(400).json({ error: `Files not found on this book: ${invalidIds.join(', ')}` });
      return;
    }

    // Must leave at least one file on the source book
    if (fileIds.length >= allFiles.length) {
      res.status(400).json({ error: 'Cannot move all files — at least one must remain on the source book' });
      return;
    }

    const splitTx = sqlite.transaction(() => {
      // Create new book with same basic metadata
      const newBook = db.insert(schema.books).values({
        title: `${book.title} (split)`,
        language: book.language,
      }).returning().get();

      // Copy author associations
      const authorLinks = db.select().from(schema.bookAuthors)
        .where(eq(schema.bookAuthors.bookId, bookId)).all();
      for (const link of authorLinks) {
        db.insert(schema.bookAuthors).values({
          bookId: newBook.id,
          authorId: link.authorId,
          role: link.role,
        }).onConflictDoNothing().run();
      }

      // Move selected files to new book
      for (const fileId of fileIds) {
        db.update(schema.files)
          .set({ bookId: newBook.id })
          .where(eq(schema.files.id, fileId))
          .run();
      }

      // Move associated audio tracks
      for (const fileId of fileIds) {
        db.update(schema.audioTracks)
          .set({ bookId: newBook.id })
          .where(sql`${schema.audioTracks.fileId} = ${fileId} AND ${schema.audioTracks.bookId} = ${bookId}`)
          .run();
      }

      return newBook;
    });

    const newBook = splitTx();
    res.json({ message: 'Files split into new book', newBookId: newBook.id });
  } catch (error) {
    console.error('[Books] Split error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Reassign a file to a different book
booksRouter.put('/files/:fileId/reassign', (req, res) => {
  try {
    const fileId = Number.parseInt(req.params.fileId);
    if (Number.isNaN(fileId)) { res.status(400).json({ error: 'Invalid file ID' }); return; }

    const { targetBookId } = req.body as { targetBookId?: number };
    if (!targetBookId || Number.isNaN(targetBookId)) {
      res.status(400).json({ error: 'targetBookId is required' });
      return;
    }

    const file = db.select().from(schema.files).where(eq(schema.files.id, fileId)).get();
    if (!file) { res.status(404).json({ error: 'File not found' }); return; }

    const targetBook = db.select().from(schema.books).where(eq(schema.books.id, targetBookId)).get();
    if (!targetBook) { res.status(404).json({ error: 'Target book not found' }); return; }

    if (file.bookId === targetBookId) {
      res.status(400).json({ error: 'File already belongs to that book' });
      return;
    }

    const reassignTx = sqlite.transaction(() => {
      const sourceBookId = file.bookId;

      // Move the file
      db.update(schema.files)
        .set({ bookId: targetBookId })
        .where(eq(schema.files.id, fileId))
        .run();

      // Move associated audio tracks
      db.update(schema.audioTracks)
        .set({ bookId: targetBookId })
        .where(sql`${schema.audioTracks.fileId} = ${fileId} AND ${schema.audioTracks.bookId} = ${sourceBookId}`)
        .run();
    });

    reassignTx();
    res.json({ message: 'File reassigned' });
  } catch (error) {
    console.error('[Books] Reassign error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete book match (clear Hardcover metadata)
booksRouter.delete('/:id/match', (req, res) => {
  try {
    const bookId = Number.parseInt(req.params.id);
    if (Number.isNaN(bookId)) { res.status(400).json({ error: 'Invalid book ID' }); return; }

    const book = db.select().from(schema.books).where(eq(schema.books.id, bookId)).get();
    if (!book) { res.status(404).json({ error: 'Book not found' }); return; }

    db.update(schema.books).set({
      hardcoverId: null,
      hardcoverSlug: null,
      matchConfidence: null,
      matchBreakdown: null,
      updatedAt: new Date().toISOString(),
    }).where(eq(schema.books.id, bookId)).run();

    // Remove metadata cache
    db.delete(schema.metadataCache).where(eq(schema.metadataCache.bookId, bookId)).run();

    res.json({ message: 'Match cleared' });
  } catch (error) {
    console.error('[Books] Clear match error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Detect duplicate books
booksRouter.get('/duplicates', (_req, res) => {
  try {
    const groups = detectDuplicates();
    res.json(groups);
  } catch (error) {
    console.error('[Books] Duplicates error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Merge two books: move files from source to target, delete source
booksRouter.post('/merge', (req, res) => {
  try {
    const { sourceBookId, targetBookId } = req.body as { sourceBookId?: number; targetBookId?: number };
    if (!sourceBookId || !targetBookId || Number.isNaN(sourceBookId) || Number.isNaN(targetBookId)) {
      res.status(400).json({ error: 'sourceBookId and targetBookId are required' });
      return;
    }
    if (sourceBookId === targetBookId) {
      res.status(400).json({ error: 'Source and target must be different books' });
      return;
    }

    const source = db.select().from(schema.books).where(eq(schema.books.id, sourceBookId)).get();
    const target = db.select().from(schema.books).where(eq(schema.books.id, targetBookId)).get();
    if (!source) { res.status(404).json({ error: 'Source book not found' }); return; }
    if (!target) { res.status(404).json({ error: 'Target book not found' }); return; }

    const mergeTx = sqlite.transaction(() => {
      // Move all files
      db.update(schema.files)
        .set({ bookId: targetBookId })
        .where(eq(schema.files.bookId, sourceBookId))
        .run();

      // Move audio tracks
      db.update(schema.audioTracks)
        .set({ bookId: targetBookId })
        .where(eq(schema.audioTracks.bookId, sourceBookId))
        .run();

      // Copy author links that don't already exist on target
      const sourceAuthors = db.select().from(schema.bookAuthors)
        .where(eq(schema.bookAuthors.bookId, sourceBookId)).all();
      for (const link of sourceAuthors) {
        db.insert(schema.bookAuthors)
          .values({ bookId: targetBookId, authorId: link.authorId, role: link.role })
          .onConflictDoNothing().run();
      }

      // Copy series links
      const sourceSeries = db.select().from(schema.bookSeries)
        .where(eq(schema.bookSeries.bookId, sourceBookId)).all();
      for (const link of sourceSeries) {
        db.insert(schema.bookSeries)
          .values({ bookId: targetBookId, seriesId: link.seriesId, position: link.position })
          .onConflictDoNothing().run();
      }

      // Copy tag links
      const sourceTags = db.select().from(schema.bookTags)
        .where(eq(schema.bookTags.bookId, sourceBookId)).all();
      for (const link of sourceTags) {
        db.insert(schema.bookTags)
          .values({ bookId: targetBookId, tagId: link.tagId })
          .onConflictDoNothing().run();
      }

      // Delete source book (cascading deletes handle join tables)
      db.delete(schema.bookAuthors).where(eq(schema.bookAuthors.bookId, sourceBookId)).run();
      db.delete(schema.bookSeries).where(eq(schema.bookSeries.bookId, sourceBookId)).run();
      db.delete(schema.bookTags).where(eq(schema.bookTags.bookId, sourceBookId)).run();
      db.delete(schema.books).where(eq(schema.books.id, sourceBookId)).run();
    });

    mergeTx();
    res.json({ message: 'Books merged', targetBookId });
  } catch (error) {
    console.error('[Books] Merge error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Bulk delete books
booksRouter.post('/bulk/delete', (req, res) => {
  try {
    const { bookIds } = req.body as { bookIds?: number[] };
    if (!Array.isArray(bookIds) || bookIds.length === 0) {
      res.status(400).json({ error: 'bookIds array is required' });
      return;
    }

    const deleteTx = sqlite.transaction(() => {
      for (const id of bookIds) {
        db.delete(schema.books).where(eq(schema.books.id, id)).run();
      }
    });

    deleteTx();
    res.json({ message: `Deleted ${bookIds.length} books` });
  } catch (error) {
    console.error('[Books] Bulk delete error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Bulk add/remove tags
booksRouter.post('/bulk/tag', (req, res) => {
  try {
    const { bookIds, addTags, removeTags } = req.body as {
      bookIds?: number[];
      addTags?: string[];
      removeTags?: string[];
    };
    if (!Array.isArray(bookIds) || bookIds.length === 0) {
      res.status(400).json({ error: 'bookIds array is required' });
      return;
    }

    const tagTx = sqlite.transaction(() => {
      // Add tags
      if (addTags && addTags.length > 0) {
        for (const tagName of addTags) {
          const name = tagName.trim();
          if (!name) continue;
          let tag = db.select().from(schema.tags).where(eq(schema.tags.name, name)).get();
          tag ??= db.insert(schema.tags).values({ name }).returning().get();
          for (const bookId of bookIds) {
            db.insert(schema.bookTags)
              .values({ bookId, tagId: tag.id })
              .onConflictDoNothing().run();
          }
        }
      }

      // Remove tags
      if (removeTags && removeTags.length > 0) {
        for (const tagName of removeTags) {
          const tag = db.select().from(schema.tags).where(eq(schema.tags.name, tagName.trim())).get();
          if (!tag) continue;
          for (const bookId of bookIds) {
            db.delete(schema.bookTags)
              .where(sql`${schema.bookTags.bookId} = ${bookId} AND ${schema.bookTags.tagId} = ${tag.id}`)
              .run();
          }
        }
      }
    });

    tagTx();
    res.json({ message: 'Tags updated' });
  } catch (error) {
    console.error('[Books] Bulk tag error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Bulk add to collection
booksRouter.post('/bulk/collection', (req, res) => {
  try {
    const { bookIds, collectionId } = req.body as { bookIds?: number[]; collectionId?: number };
    if (!Array.isArray(bookIds) || bookIds.length === 0 || !collectionId) {
      res.status(400).json({ error: 'bookIds and collectionId are required' });
      return;
    }

    const collection = db.select().from(schema.collections).where(eq(schema.collections.id, collectionId)).get();
    if (!collection) { res.status(404).json({ error: 'Collection not found' }); return; }

    const addTx = sqlite.transaction(() => {
      for (const bookId of bookIds) {
        db.insert(schema.bookCollections)
          .values({ collectionId, bookId })
          .onConflictDoNothing().run();
      }
    });

    addTx();
    res.json({ message: `Added ${bookIds.length} books to collection` });
  } catch (error) {
    console.error('[Books] Bulk collection error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Bulk queue metadata match
booksRouter.post('/bulk/match', (_req, res) => {
  try {
    const { bookIds } = _req.body as { bookIds?: number[] };
    if (!Array.isArray(bookIds) || bookIds.length === 0) {
      res.status(400).json({ error: 'bookIds array is required' });
      return;
    }

    for (const bookId of bookIds) {
      enqueueJob('match_metadata', { bookId });
    }

    res.json({ message: `Queued metadata match for ${bookIds.length} books` });
  } catch (error) {
    console.error('[Books] Bulk match error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Bulk assign to series
booksRouter.post('/bulk/series', (req, res) => {
  try {
    const { bookIds, seriesId } = req.body as { bookIds?: number[]; seriesId?: number };
    if (!Array.isArray(bookIds) || bookIds.length === 0 || !seriesId) {
      res.status(400).json({ error: 'bookIds and seriesId are required' });
      return;
    }

    const series = db.select().from(schema.series).where(eq(schema.series.id, seriesId)).get();
    if (!series) { res.status(404).json({ error: 'Series not found' }); return; }

    const addTx = sqlite.transaction(() => {
      for (const bookId of bookIds) {
        db.insert(schema.bookSeries)
          .values({ bookId, seriesId, position: null })
          .onConflictDoNothing().run();
      }
    });

    addTx();
    res.json({ message: `Added ${bookIds.length} books to series` });
  } catch (error) {
    console.error('[Books] Bulk series error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Convert book file to another format
booksRouter.post('/:id/convert', (req, res) => {
  try {
    const bookId = Number.parseInt(req.params.id);
    if (Number.isNaN(bookId)) { res.status(400).json({ error: 'Invalid book ID' }); return; }

    const { fileId, targetFormat } = req.body as { fileId?: number; targetFormat?: string };
    if (!fileId || !targetFormat) {
      res.status(400).json({ error: 'fileId and targetFormat are required' });
      return;
    }

    if (!isConvertAvailable()) {
      res.status(503).json({ error: 'Calibre (ebook-convert) is not installed on this system' });
      return;
    }

    // Verify file belongs to this book
    const file = db.select().from(schema.files).where(eq(schema.files.id, fileId)).get();
    if (file?.bookId !== bookId) {
      res.status(404).json({ error: 'File not found on this book' });
      return;
    }

    const allowed = SUPPORTED_CONVERSIONS[file.format];
    if (!allowed?.includes(targetFormat)) {
      res.status(400).json({ error: `Cannot convert ${file.format} to ${targetFormat}` });
      return;
    }

    enqueueJob('convert_format', { bookId, fileId, targetFormat });
    res.status(202).json({ message: 'Conversion job queued' });
  } catch (error) {
    console.error('[Books] Convert error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete book (from index only, not disk)
booksRouter.delete('/:id', (req, res) => {
  try {
    const bookId = Number.parseInt(req.params.id);
    if (Number.isNaN(bookId)) { res.status(400).json({ error: 'Invalid book ID' }); return; }
    const book = db.select().from(schema.books).where(eq(schema.books.id, bookId)).get();
    if (!book) {
      res.status(404).json({ error: 'Book not found' });
      return;
    }

    db.delete(schema.books).where(eq(schema.books.id, bookId)).run();
    res.json({ message: 'Book removed from library' });
  } catch (error) {
    console.error('[Books] Delete error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
