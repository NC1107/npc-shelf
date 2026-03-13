import { Router } from 'express';
import { eq, desc, asc, sql, like } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

export const booksRouter = Router();

// Library stats
booksRouter.get('/stats', (_req, res) => {
  try {
    const totalBooks = db.select({ count: sql<number>`count(*)` }).from(schema.books).get()!.count;
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
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 24));
    const sortBy = (req.query.sortBy as string) || 'title';
    const sortOrder = (req.query.sortOrder as string) === 'desc' ? 'desc' : 'asc';
    const q = req.query.q as string | undefined;
    const format = req.query.format as string | undefined;
    const authorId = req.query.authorId as string | undefined;
    const seriesId = req.query.seriesId as string | undefined;

    let bookIds: number[] | undefined;

    // FTS5 search
    if (q) {
      const ftsResults = db
        .all<{ rowid: number }>(
          sql`SELECT rowid FROM books_fts WHERE books_fts MATCH ${q + '*'} ORDER BY rank LIMIT 1000`,
        );
      bookIds = ftsResults.map((r) => r.rowid);
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
        .where(eq(schema.bookAuthors.authorId, parseInt(authorId)))
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
        .where(eq(schema.bookSeries.seriesId, parseInt(seriesId)))
        .all();
      const seriesBookIds = seriesResults.map((r) => r.bookId);
      bookIds = bookIds
        ? bookIds.filter((id) => seriesBookIds.includes(id))
        : seriesBookIds;
    }

    // Build query
    let query = db.select().from(schema.books).$dynamic();

    if (bookIds !== undefined) {
      if (bookIds.length === 0) {
        res.json({ items: [], total: 0, page, pageSize, totalPages: 0 });
        return;
      }
      query = query.where(sql`${schema.books.id} IN (${sql.join(bookIds.map(id => sql`${id}`), sql`, `)})`);
    }

    // Count total
    const countResult = bookIds !== undefined
      ? { count: bookIds.length }
      : db.select({ count: sql<number>`count(*)` }).from(schema.books).get()!;
    const total = countResult.count;
    const totalPages = Math.ceil(total / pageSize);

    // Sort
    const orderColumn = sortBy === 'createdAt' ? schema.books.createdAt
      : sortBy === 'updatedAt' ? schema.books.updatedAt
      : schema.books.title;
    const orderFn = sortOrder === 'desc' ? desc : asc;

    const rawItems = query
      .orderBy(orderFn(orderColumn))
      .limit(pageSize)
      .offset((page - 1) * pageSize)
      .all();

    // Enrich with authors and formats for BookCard display
    const items = rawItems.map((book) => {
      const authorRows = db
        .select({ name: schema.authors.name })
        .from(schema.bookAuthors)
        .innerJoin(schema.authors, eq(schema.bookAuthors.authorId, schema.authors.id))
        .where(eq(schema.bookAuthors.bookId, book.id))
        .all();

      const formatRows = db
        .selectDistinct({ format: schema.files.format })
        .from(schema.files)
        .where(eq(schema.files.bookId, book.id))
        .all();

      return {
        ...book,
        authors: authorRows.map((a) => ({ author: { name: a.name } })),
        formats: formatRows.map((f) => f.format),
      };
    });

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
    const bookId = parseInt(req.params.id);
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

    res.json({
      ...book,
      authors,
      series: seriesList,
      files,
      tags,
      readingProgress,
      audioProgress,
    });
  } catch (error) {
    console.error('[Books] Detail error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get cover image
booksRouter.get('/:id/cover/:size', (req, res) => {
  try {
    const bookId = parseInt(req.params.id);
    const size = req.params.size as 'thumb' | 'medium' | 'full';

    const book = db.select({ coverPath: schema.books.coverPath }).from(schema.books).where(eq(schema.books.id, bookId)).get();
    if (!book?.coverPath) {
      res.status(404).json({ error: 'No cover available' });
      return;
    }

    const coverDir = process.env.COVER_CACHE_PATH || './cache/covers';
    const coverFile = `${coverDir}/${bookId}_${size}.webp`;

    res.sendFile(coverFile, { root: process.cwd() }, (err) => {
      if (err) {
        // Try original cover
        res.sendFile(book.coverPath!, { root: process.cwd() }, (err2) => {
          if (err2) res.status(404).json({ error: 'Cover not found' });
        });
      }
    });
  } catch (error) {
    console.error('[Books] Cover error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Download book file
booksRouter.get('/:id/file', (req, res) => {
  try {
    const bookId = parseInt(req.params.id);
    const formatPref = req.query.format as string | undefined;

    let fileQuery = db.select().from(schema.files).where(eq(schema.files.bookId, bookId));
    const files = fileQuery.all();

    if (files.length === 0) {
      res.status(404).json({ error: 'No files found' });
      return;
    }

    const file = formatPref
      ? files.find((f) => f.format === formatPref) || files[0]
      : files[0];

    res.download(file.path, file.filename);
  } catch (error) {
    console.error('[Books] Download error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete book (from index only, not disk)
// Download book file
booksRouter.get('/:id/file', (req, res) => {
  try {
    const bookId = parseInt(req.params.id);
    const formatPref = req.query.format as string | undefined;

    let file;
    if (formatPref) {
      file = db.select().from(schema.files)
        .where(sql`${schema.files.bookId} = ${bookId} AND ${schema.files.format} = ${formatPref}`)
        .get();
    }
    if (!file) {
      file = db.select().from(schema.files).where(eq(schema.files.bookId, bookId)).get();
    }

    if (!file) {
      res.status(404).json({ error: 'No file found' });
      return;
    }

    const fs = require('node:fs');
    if (!fs.existsSync(file.path)) {
      res.status(404).json({ error: 'File not found on disk' });
      return;
    }

    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.sendFile(file.path);
  } catch (error) {
    console.error('[Books] File download error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

booksRouter.delete('/:id', (req, res) => {
  try {
    const bookId = parseInt(req.params.id);
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
