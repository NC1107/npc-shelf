import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { previewRename, executeRename } from '../services/file-renamer.js';
import { writeBookMetadata } from '../services/metadata-writer.js';

export const renameRouter = Router();

// Preview rename for a single book
renameRouter.post('/:id/rename/preview', (req, res) => {
  try {
    const bookId = Number.parseInt(req.params.id);
    if (Number.isNaN(bookId)) { res.status(400).json({ error: 'Invalid book ID' }); return; }

    const book = db.select().from(schema.books).where(eq(schema.books.id, bookId)).get();
    if (!book) { res.status(404).json({ error: 'Book not found' }); return; }

    const preview = previewRename(bookId);
    res.json(preview);
  } catch (error) {
    console.error('[Rename] Preview error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Execute rename for a single book
renameRouter.post('/:id/rename/execute', (req, res) => {
  try {
    const bookId = Number.parseInt(req.params.id);
    if (Number.isNaN(bookId)) { res.status(400).json({ error: 'Invalid book ID' }); return; }

    const book = db.select().from(schema.books).where(eq(schema.books.id, bookId)).get();
    if (!book) { res.status(404).json({ error: 'Book not found' }); return; }

    const results = executeRename(bookId);
    const succeeded = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    res.json({ results, summary: { succeeded, failed } });
  } catch (error) {
    console.error('[Rename] Execute error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Write metadata into files for a book
renameRouter.post('/:id/write-metadata', async (req, res) => {
  try {
    const bookId = Number.parseInt(req.params.id);
    if (Number.isNaN(bookId)) { res.status(400).json({ error: 'Invalid book ID' }); return; }

    const book = db.select().from(schema.books).where(eq(schema.books.id, bookId)).get();
    if (!book) { res.status(404).json({ error: 'Book not found' }); return; }

    const results = await writeBookMetadata(bookId);
    const succeeded = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    res.json({ results, summary: { succeeded, failed } });
  } catch (error) {
    console.error('[Metadata] Write error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
