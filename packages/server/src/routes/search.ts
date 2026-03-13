import { Router } from 'express';
import { sql, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

export const searchRouter = Router();

// Global search using FTS5
searchRouter.get('/', (req, res) => {
  try {
    const q = req.query.q as string;
    if (!q || q.trim().length === 0) {
      res.json({ books: [], authors: [], series: [] });
      return;
    }

    const limit = Math.min(50, parseInt(req.query.limit as string) || 20);

    // Search books via FTS5 — transform multi-word queries for proper FTS5 syntax
    // "brandon sanderson" → '"brandon"* "sanderson"*' (implicit AND with prefix matching)
    const ftsQuery = q.trim().split(/\s+/).map(word => `"${word}"*`).join(' ');
    let ftsBookIds: number[] = [];
    try {
      const bookResults = db
        .all<{ rowid: number; rank: number }>(
          sql`SELECT rowid, rank FROM books_fts WHERE books_fts MATCH ${ftsQuery} ORDER BY rank LIMIT ${limit}`,
        );
      ftsBookIds = bookResults.map((r) => r.rowid);
    } catch (ftsErr) {
      console.warn('[Search] FTS5 query failed:', ftsErr);
    }

    // Also find books by matching authors
    const matchingAuthors = db
      .select({ id: schema.authors.id })
      .from(schema.authors)
      .where(sql`${schema.authors.name} LIKE ${'%' + q + '%'}`)
      .all();

    let authorBookIds: number[] = [];
    if (matchingAuthors.length > 0) {
      const authorIds = matchingAuthors.map(a => a.id);
      authorBookIds = db
        .select({ bookId: schema.bookAuthors.bookId })
        .from(schema.bookAuthors)
        .where(sql`${schema.bookAuthors.authorId} IN (${sql.join(authorIds.map(id => sql`${id}`), sql`, `)})`)
        .all()
        .map(r => r.bookId);
    }

    // Merge FTS and author-based book IDs, deduplicate
    const bookIds = [...new Set([...ftsBookIds, ...authorBookIds])];
    const books =
      bookIds.length > 0
        ? db
            .select()
            .from(schema.books)
            .where(sql`${schema.books.id} IN (${sql.join(bookIds.map(id => sql`${id}`), sql`, `)})`)
            .all()
        : [];

    // Search authors by name
    const authors = db
      .select()
      .from(schema.authors)
      .where(sql`${schema.authors.name} LIKE ${'%' + q + '%'}`)
      .limit(limit)
      .all();

    // Search series by name
    const seriesList = db
      .select()
      .from(schema.series)
      .where(sql`${schema.series.name} LIKE ${'%' + q + '%'}`)
      .limit(limit)
      .all();

    res.json({ books, authors, series: seriesList });
  } catch (error) {
    console.error('[Search] Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
