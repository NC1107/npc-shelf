import { Router } from 'express';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

export const metadataRouter = Router();

// Trigger metadata match for a book
metadataRouter.post('/match/:bookId', (req, res) => {
  try {
    const bookId = parseInt(req.params.bookId);
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

// Search Hardcover directly
metadataRouter.get('/search', (req, res) => {
  try {
    const q = req.query.q as string;
    if (!q) {
      res.status(400).json({ error: 'Query parameter q is required' });
      return;
    }

    // TODO: Implement Hardcover GraphQL search
    res.json({ results: [], query: q });
  } catch (error) {
    console.error('[Metadata] Search error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Manual metadata edit
metadataRouter.put('/books/:id/metadata', (req, res) => {
  try {
    const bookId = parseInt(req.params.id);
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

// Export metadata as OPF/JSON sidecar
metadataRouter.post('/books/:id/export', (req, res) => {
  try {
    const bookId = parseInt(req.params.id);
    const book = db.select().from(schema.books).where(eq(schema.books.id, bookId)).get();
    if (!book) {
      res.status(404).json({ error: 'Book not found' });
      return;
    }

    // TODO: Implement OPF/JSON export
    res.json({ message: 'Export not yet implemented', bookId });
  } catch (error) {
    console.error('[Metadata] Export error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
