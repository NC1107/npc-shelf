import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { searchProvider, applyMatch } from '../services/metadata-pipeline.js';

export const metadataRouter = Router();

// Trigger metadata match for a book
metadataRouter.post('/match/:bookId', (req, res) => {
  try {
    const bookId = Number.parseInt(req.params.bookId);
    const book = db.select().from(schema.books).where(eq(schema.books.id, bookId)).get();
    if (!book) {
      res.status(404).json({ error: 'Book not found' });
      return;
    }

    db.insert(schema.jobQueue)
      .values({
        jobType: 'match_metadata',
        payload: JSON.stringify({ bookId }),
      })
      .run();

    res.json({ message: 'Metadata match queued', bookId });
  } catch (error) {
    console.error('[Metadata] Match error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Batch match all unmatched books
metadataRouter.post('/match-all', (_req, res) => {
  try {
    db.insert(schema.jobQueue)
      .values({
        jobType: 'match_all_metadata',
        payload: '{}',
      })
      .run();

    res.json({ message: 'Batch metadata match queued' });
  } catch (error) {
    console.error('[Metadata] Match all error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Search provider directly (for manual matching)
metadataRouter.get('/search', async (req, res) => {
  try {
    const q = req.query.q as string;
    if (!q) {
      res.status(400).json({ error: 'Query parameter q is required' });
      return;
    }

    const results = await searchProvider(q);
    res.json({ results, query: q });
  } catch (error) {
    console.error('[Metadata] Search error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Apply a specific match to a book (manual matching)
metadataRouter.post('/apply/:bookId', async (req, res) => {
  try {
    const bookId = Number.parseInt(req.params.bookId);
    const { externalId } = req.body;
    if (!externalId) {
      res.status(400).json({ error: 'externalId is required' });
      return;
    }

    const book = db.select().from(schema.books).where(eq(schema.books.id, bookId)).get();
    if (!book) {
      res.status(404).json({ error: 'Book not found' });
      return;
    }

    await applyMatch(bookId, externalId);

    const updated = db.select().from(schema.books).where(eq(schema.books.id, bookId)).get();
    res.json(updated);
  } catch (error) {
    console.error('[Metadata] Apply error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Manual metadata edit
metadataRouter.put('/books/:id/metadata', (req, res) => {
  try {
    const bookId = Number.parseInt(req.params.id);
    const { title, subtitle, description, language, publisher, publishDate, pageCount, isbn10, isbn13 } = req.body;

    const book = db.select().from(schema.books).where(eq(schema.books.id, bookId)).get();
    if (!book) {
      res.status(404).json({ error: 'Book not found' });
      return;
    }

    db.update(schema.books)
      .set({
        ...(title !== undefined && { title }),
        ...(subtitle !== undefined && { subtitle }),
        ...(description !== undefined && { description }),
        ...(language !== undefined && { language }),
        ...(publisher !== undefined && { publisher }),
        ...(publishDate !== undefined && { publishDate }),
        ...(pageCount !== undefined && { pageCount }),
        ...(isbn10 !== undefined && { isbn10 }),
        ...(isbn13 !== undefined && { isbn13 }),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.books.id, bookId))
      .run();

    const updated = db.select().from(schema.books).where(eq(schema.books.id, bookId)).get();
    res.json(updated);
  } catch (error) {
    console.error('[Metadata] Update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Export metadata as JSON sidecar
metadataRouter.post('/books/:id/export', (req, res) => {
  try {
    const bookId = Number.parseInt(req.params.id);
    const book = db.select().from(schema.books).where(eq(schema.books.id, bookId)).get();
    if (!book) {
      res.status(404).json({ error: 'Book not found' });
      return;
    }

    // Get full book detail
    const authors = db
      .select({ name: schema.authors.name, role: schema.bookAuthors.role })
      .from(schema.bookAuthors)
      .innerJoin(schema.authors, eq(schema.bookAuthors.authorId, schema.authors.id))
      .where(eq(schema.bookAuthors.bookId, bookId))
      .all();

    const series = db
      .select({ name: schema.series.name, position: schema.bookSeries.position })
      .from(schema.bookSeries)
      .innerJoin(schema.series, eq(schema.bookSeries.seriesId, schema.series.id))
      .where(eq(schema.bookSeries.bookId, bookId))
      .all();

    const tags = db
      .select({ name: schema.tags.name })
      .from(schema.bookTags)
      .innerJoin(schema.tags, eq(schema.bookTags.tagId, schema.tags.id))
      .where(eq(schema.bookTags.bookId, bookId))
      .all();

    res.json({
      title: book.title,
      subtitle: book.subtitle,
      authors: authors.map((a) => ({ name: a.name, role: a.role })),
      description: book.description,
      publisher: book.publisher,
      publishDate: book.publishDate,
      language: book.language,
      isbn10: book.isbn10,
      isbn13: book.isbn13,
      pageCount: book.pageCount,
      series: series.map((s) => ({ name: s.name, position: s.position })),
      tags: tags.map((t) => t.name),
      hardcoverId: book.hardcoverId,
    });
  } catch (error) {
    console.error('[Metadata] Export error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
