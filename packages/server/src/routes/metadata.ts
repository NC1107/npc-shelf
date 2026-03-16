import { Router } from 'express';
import { eq, sql } from 'drizzle-orm';
import { db, schema, sqlite } from '../db/index.js';
import { searchProvider, applyMatch, getProvider } from '../services/metadata-pipeline.js';

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

// Batch match all unmatched books (force=true clears existing matches first)
metadataRouter.post('/match-all', (req, res) => {
  try {
    const force = req.body?.force === true;
    db.insert(schema.jobQueue)
      .values({
        jobType: 'match_all_metadata',
        payload: JSON.stringify({ force }),
      })
      .run();

    res.json({ message: force ? 'Force re-match of all books queued' : 'Batch metadata match queued' });
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

// Fetch Hardcover book details by external ID
metadataRouter.get('/details/:externalId', async (req, res) => {
  try {
    const { externalId } = req.params;
    const provider = getProvider();
    const details = await provider.getDetails(externalId);
    if (!details) {
      res.status(404).json({ error: 'Hardcover book not found' });
      return;
    }
    res.json(details);
  } catch (error) {
    console.error('[Metadata] Details error:', error);
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

    // Get primary author for correction record
    const authorRow = db.select({ name: schema.authors.name })
      .from(schema.bookAuthors)
      .innerJoin(schema.authors, eq(schema.bookAuthors.authorId, schema.authors.id))
      .where(eq(schema.bookAuthors.bookId, bookId))
      .get();

    await applyMatch(bookId, externalId);

    // Store match correction for future auto-matching
    const updated = db.select().from(schema.books).where(eq(schema.books.id, bookId)).get();
    if (updated) {
      db.insert(schema.matchCorrections).values({
        localTitle: book.title,
        localAuthor: authorRow?.name ?? null,
        matchedExternalId: externalId,
        matchedTitle: updated.title,
        matchedAuthor: authorRow?.name ?? null,
      }).run();
    }

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

// Fetch user's Hardcover reading list and cross-reference with local books
metadataRouter.get('/hardcover-library', async (req, res) => {
  try {
    const provider = getProvider();
    if (!('getUserBooks' in provider)) {
      res.status(400).json({ error: 'Hardcover provider does not support user book fetching' });
      return;
    }
    const hcProvider = provider as any;
    if (typeof hcProvider.hasToken === 'function' && !hcProvider.hasToken()) {
      res.status(400).json({ error: 'No Hardcover API token configured. Add your token in Settings → Metadata.' });
      return;
    }

    let userBooks;
    try {
      userBooks = await hcProvider.getUserBooks();
    } catch (error: any) {
      const msg = error.response?.errors?.[0]?.message || error.message || 'Unknown error';
      console.error('[Metadata] Hardcover API error:', msg);
      res.status(502).json({ error: `Hardcover API error: ${msg}` });
      return;
    }
    if (!userBooks || userBooks.length === 0) {
      res.json({ matched: [], missing: [], stats: { total: 0, matched: 0, missing: 0 } });
      return;
    }

    const HC_STATUS_NAMES: Record<number, string> = { 1: 'Want to Read', 2: 'Currently Reading', 3: 'Read', 4: 'Paused', 5: 'Did Not Finish' };
    const HC_TO_LOCAL: Record<number, string> = { 1: 'unread', 2: 'reading', 3: 'finished', 4: 'reading', 5: 'finished' };

    const matched: any[] = [];
    const missing: any[] = [];

    for (const hcBook of userBooks) {
      const localBook = db.select().from(schema.books)
        .where(eq(schema.books.hardcoverId, String(hcBook.hardcoverId)))
        .get();

      if (localBook) {
        matched.push({
          localBook,
          hardcoverStatus: hcBook.statusId,
          hardcoverStatusName: HC_STATUS_NAMES[hcBook.statusId] || 'Unknown',
          suggestedLocalStatus: HC_TO_LOCAL[hcBook.statusId] || null,
        });
      } else {
        missing.push({
          hardcoverId: hcBook.hardcoverId,
          title: hcBook.title,
          slug: hcBook.slug,
          imageUrl: hcBook.imageUrl,
          authorNames: hcBook.authorNames,
          statusId: hcBook.statusId,
          statusName: HC_STATUS_NAMES[hcBook.statusId] || 'Unknown',
        });
      }
    }

    res.json({
      matched,
      missing,
      stats: { total: userBooks.length, matched: matched.length, missing: missing.length },
    });
  } catch (error) {
    console.error('[Metadata] Hardcover library error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Batch-update reading status from Hardcover sync
metadataRouter.post('/sync-hardcover-status', (req, res) => {
  try {
    const { updates } = req.body as { updates?: { bookId: number; readingStatus: string }[] };
    if (!Array.isArray(updates) || updates.length === 0) {
      res.status(400).json({ error: 'updates array is required' });
      return;
    }

    const validStatuses = new Set(['unread', 'reading', 'finished']);
    const syncTx = sqlite.transaction(() => {
      let updated = 0;
      for (const { bookId, readingStatus } of updates) {
        if (!validStatuses.has(readingStatus)) continue;
        db.update(schema.books)
          .set({ readingStatus, updatedAt: new Date().toISOString() })
          .where(eq(schema.books.id, bookId))
          .run();
        updated++;
      }
      return updated;
    });

    const count = syncTx();
    res.json({ message: `Updated ${count} books`, updated: count });
  } catch (error) {
    console.error('[Metadata] Sync status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create collections from Hardcover reading lists
metadataRouter.post('/sync-hardcover-collections', (req, res) => {
  try {
    const userId = req.user!.userId;
    const { books } = req.body as {
      books?: { bookId: number; statusName: string }[];
    };
    if (!Array.isArray(books) || books.length === 0) {
      res.status(400).json({ error: 'books array is required' });
      return;
    }

    const collectionNames = [...new Set(books.map(b => b.statusName))];
    let collectionsCreated = 0;
    let booksAdded = 0;

    const syncTx = sqlite.transaction(() => {
      for (const name of collectionNames) {
        let collection = db.select().from(schema.collections)
          .where(sql`${schema.collections.userId} = ${userId} AND ${schema.collections.name} = ${name}`)
          .get();
        if (!collection) {
          collection = db.insert(schema.collections)
            .values({ userId, name })
            .returning().get();
          collectionsCreated++;
        }

        const booksForCollection = books.filter(b => b.statusName === name);
        for (const { bookId } of booksForCollection) {
          db.insert(schema.bookCollections)
            .values({ bookId, collectionId: collection.id })
            .onConflictDoNothing().run();
          booksAdded++;
        }
      }
    });

    syncTx();
    res.json({ collectionsCreated, booksAdded });
  } catch (error) {
    console.error('[Metadata] Sync collections error:', error);
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
