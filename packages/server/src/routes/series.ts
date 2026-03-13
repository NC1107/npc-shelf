import { Router } from 'express';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

export const seriesRouter = Router();

// List all series with book counts
seriesRouter.get('/', (_req, res) => {
  try {
    const seriesList = db
      .select()
      .from(schema.series)
      .orderBy(schema.series.name)
      .all()
      .map((s) => {
        const bookCount = db
          .select({ count: sql<number>`count(*)` })
          .from(schema.bookSeries)
          .where(eq(schema.bookSeries.seriesId, s.id))
          .get()?.count || 0;
        return { ...s, bookCount };
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
    const id = parseInt(req.params.id);
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

    const books = bookEntries.map((entry) => {
      const book = db.select().from(schema.books).where(eq(schema.books.id, entry.bookId)).get();
      if (!book) return null;

      const authors = db
        .select({ name: schema.authors.name })
        .from(schema.bookAuthors)
        .innerJoin(schema.authors, eq(schema.bookAuthors.authorId, schema.authors.id))
        .where(eq(schema.bookAuthors.bookId, book.id))
        .all();

      const formats = db
        .selectDistinct({ format: schema.files.format })
        .from(schema.files)
        .where(eq(schema.files.bookId, book.id))
        .all();

      return {
        ...book,
        position: entry.position,
        authors: authors.map((a) => ({ author: { name: a.name } })),
        formats: formats.map((f) => f.format),
      };
    }).filter(Boolean).sort((a: any, b: any) => (a.position || 999) - (b.position || 999));

    res.json({ ...series, books });
  } catch (error) {
    console.error('[Series] Get error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
