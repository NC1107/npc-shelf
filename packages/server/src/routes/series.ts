import { Router } from 'express';
import { eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { enrichBooksWithMeta } from '../utils/book-enricher.js';

export const seriesRouter = Router();

// List all series with book counts and cover previews
seriesRouter.get('/', (_req, res) => {
  try {
    // Query 1: all series
    const allSeries = db
      .select()
      .from(schema.series)
      .orderBy(schema.series.name)
      .all();

    if (allSeries.length === 0) {
      res.json([]);
      return;
    }

    const seriesIds = allSeries.map((s) => s.id);

    // Query 2: all bookSeries for these series
    const allBookSeries = db
      .select({
        seriesId: schema.bookSeries.seriesId,
        bookId: schema.bookSeries.bookId,
        position: schema.bookSeries.position,
      })
      .from(schema.bookSeries)
      .where(inArray(schema.bookSeries.seriesId, seriesIds))
      .all();

    // Group by seriesId
    const bookSeriesBySeriesId = new Map<number, { bookId: number; position: number | null }[]>();
    for (const bs of allBookSeries) {
      let list = bookSeriesBySeriesId.get(bs.seriesId);
      if (!list) {
        list = [];
        bookSeriesBySeriesId.set(bs.seriesId, list);
      }
      list.push({ bookId: bs.bookId, position: bs.position });
    }

    // Query 3: all books with covers (just IDs)
    const allBookIds = [...new Set(allBookSeries.map((bs) => bs.bookId))];
    const booksWithCoverSet = new Set<number>();
    if (allBookIds.length > 0) {
      const coverBooks = db
        .select({ id: schema.books.id })
        .from(schema.books)
        .where(
          sql`${schema.books.id} IN (${sql.join(allBookIds.map((id) => sql`${id}`), sql`, `)}) AND ${schema.books.coverPath} IS NOT NULL`,
        )
        .all();
      for (const b of coverBooks) booksWithCoverSet.add(b.id);
    }

    const seriesList = allSeries.map((s) => {
      const bookEntries = bookSeriesBySeriesId.get(s.id) || [];
      const bookCount = bookEntries.length;

      const bookIds = bookEntries
        .sort((a, b) => (a.position || 999) - (b.position || 999))
        .map((e) => e.bookId);

      const coverBookIds: number[] = [];
      for (const id of bookIds) {
        if (booksWithCoverSet.has(id)) coverBookIds.push(id);
        if (coverBookIds.length >= 4) break;
      }

      return { ...s, bookCount, coverBookIds };
    });

    res.json(seriesList);
  } catch (error) {
    console.error('[Series] List error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get series with books
seriesRouter.get('/:id', (req, res) => {
  try {
    const id = Number.parseInt(req.params.id);
    if (Number.isNaN(id)) { res.status(400).json({ error: 'Invalid ID' }); return; }
    const series = db.select().from(schema.series).where(eq(schema.series.id, id)).get();
    if (!series) {
      res.status(404).json({ error: 'Series not found' });
      return;
    }

    const bookEntries = db
      .select({
        bookId: schema.bookSeries.bookId,
        position: schema.bookSeries.position,
      })
      .from(schema.bookSeries)
      .where(eq(schema.bookSeries.seriesId, id))
      .all();

    // Batch-fetch all books for this series
    const bookIds = bookEntries.map((e) => e.bookId);
    const rawBooks = bookIds.length > 0
      ? db
          .select()
          .from(schema.books)
          .where(inArray(schema.books.id, bookIds))
          .all()
      : [];

    // Build position lookup from bookEntries
    const positionByBookId = new Map(bookEntries.map((e) => [e.bookId, e.position]));

    const enriched = enrichBooksWithMeta(rawBooks);
    const books = enriched
      .map((book) => ({ ...book, position: positionByBookId.get(book.id) ?? null }))
      .sort((a, b) => (a.position || 999) - (b.position || 999));

    res.json({ ...series, books });
  } catch (error) {
    console.error('[Series] Get error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
