import { Router } from 'express';
import { eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { enrichBooksWithMeta } from '../utils/book-enricher.js';

export const seriesRouter = Router();

// List all series with book counts and cover previews
seriesRouter.get('/', (_req, res) => {
  try {
    const seriesList = db
      .select()
      .from(schema.series)
      .orderBy(schema.series.name)
      .all()
      .map((s) => {
        const bookEntries = db
          .select({
            bookId: schema.bookSeries.bookId,
            position: schema.bookSeries.position,
          })
          .from(schema.bookSeries)
          .where(eq(schema.bookSeries.seriesId, s.id))
          .all();

        const bookCount = bookEntries.length;

        // Get first 4 books with covers for preview thumbnails
        const bookIds = bookEntries
          .sort((a, b) => (a.position || 999) - (b.position || 999))
          .map((e) => e.bookId);

        const coverBookIds: number[] = [];
        if (bookIds.length > 0) {
          const idPlaceholders = sql.join(bookIds.map((id) => sql`${id}`), sql`, `);
          const booksWithCovers = db
            .all<{ id: number }>(
              sql`SELECT id FROM books WHERE id IN (${idPlaceholders}) AND cover_path IS NOT NULL LIMIT 4`,
            );
          // Preserve series position order
          const coverSet = new Set(booksWithCovers.map((b) => b.id));
          for (const id of bookIds) {
            if (coverSet.has(id)) coverBookIds.push(id);
            if (coverBookIds.length >= 4) break;
          }
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
