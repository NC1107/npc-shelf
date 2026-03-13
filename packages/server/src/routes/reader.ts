import { Router } from 'express';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import fs from 'node:fs';

export const readerRouter = Router();

// Serve book content for browser reader
readerRouter.get('/books/:id/content', (req, res) => {
  try {
    const bookId = parseInt(req.params.id);
    const formatPref = (req.query.format as string) || 'epub';

    const file = db
      .select()
      .from(schema.files)
      .where(sql`${schema.files.bookId} = ${bookId} AND ${schema.files.format} = ${formatPref}`)
      .get();

    if (!file || !fs.existsSync(file.path)) {
      res.status(404).json({ error: 'Book file not found' });
      return;
    }

    // Security: set restrictive CSP for reader content
    res.setHeader('Content-Security-Policy', "script-src 'none'; object-src 'none'");
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${file.filename}"`);
    res.sendFile(file.path);
  } catch (error) {
    console.error('[Reader] Content error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get reading progress
readerRouter.get('/books/:id/progress', (req, res) => {
  try {
    const bookId = parseInt(req.params.id);
    const userId = req.user!.userId;

    const progress = db
      .select()
      .from(schema.readingProgress)
      .where(
        sql`${schema.readingProgress.userId} = ${userId} AND ${schema.readingProgress.bookId} = ${bookId}`,
      )
      .get();

    res.json(progress || null);
  } catch (error) {
    console.error('[Reader] Progress error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update reading progress
readerRouter.put('/books/:id/progress', (req, res) => {
  try {
    const bookId = parseInt(req.params.id);
    const userId = req.user!.userId;
    const { format, cfi, pageNumber, totalPages, progressPercent } = req.body;

    const existing = db
      .select()
      .from(schema.readingProgress)
      .where(
        sql`${schema.readingProgress.userId} = ${userId} AND ${schema.readingProgress.bookId} = ${bookId}`,
      )
      .get();

    if (existing) {
      db.update(schema.readingProgress)
        .set({
          format,
          cfi,
          pageNumber,
          totalPages,
          progressPercent,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(schema.readingProgress.id, existing.id))
        .run();
    } else {
      db.insert(schema.readingProgress)
        .values({
          userId,
          bookId,
          format,
          cfi,
          pageNumber,
          totalPages,
          progressPercent,
        })
        .run();
    }

    res.json({ message: 'Progress updated' });
  } catch (error) {
    console.error('[Reader] Update progress error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
