import { Router } from 'express';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

export const collectionsRouter = Router();

// List collections
collectionsRouter.get('/', (req, res) => {
  try {
    const userId = req.user!.userId;
    const collections = db
      .select()
      .from(schema.collections)
      .where(eq(schema.collections.userId, userId))
      .all()
      .map((c) => {
        const bookCount = db
          .select({ count: sql<number>`count(*)` })
          .from(schema.bookCollections)
          .where(eq(schema.bookCollections.collectionId, c.id))
          .get()?.count || 0;
        return { ...c, bookCount };
      });
    res.json(collections);
  } catch (error) {
    console.error('[Collections] List error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create collection
collectionsRouter.post('/', (req, res) => {
  try {
    const userId = req.user!.userId;
    const { name, description } = req.body;
    if (!name) {
      res.status(400).json({ error: 'Name is required' });
      return;
    }

    const collection = db
      .insert(schema.collections)
      .values({ userId, name, description })
      .returning()
      .get();

    res.status(201).json(collection);
  } catch (error) {
    console.error('[Collections] Create error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get collection with books
collectionsRouter.get('/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const collection = db.select().from(schema.collections).where(eq(schema.collections.id, id)).get();
    if (!collection) {
      res.status(404).json({ error: 'Collection not found' });
      return;
    }

    const bookIds = db
      .select({ bookId: schema.bookCollections.bookId })
      .from(schema.bookCollections)
      .where(eq(schema.bookCollections.collectionId, id))
      .all()
      .map((r) => r.bookId);

    let books: any[] = [];
    if (bookIds.length > 0) {
      books = db
        .select()
        .from(schema.books)
        .where(sql`${schema.books.id} IN (${sql.join(bookIds.map(bid => sql`${bid}`), sql`, `)})`)
        .all()
        .map((book) => {
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
            authors: authors.map((a) => ({ author: { name: a.name } })),
            formats: formats.map((f) => f.format),
          };
        });
    }

    res.json({ ...collection, books });
  } catch (error) {
    console.error('[Collections] Get error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update collection
collectionsRouter.put('/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { name, description } = req.body;

    const updated = db
      .update(schema.collections)
      .set({
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
      })
      .where(eq(schema.collections.id, id))
      .returning()
      .get();

    if (!updated) {
      res.status(404).json({ error: 'Collection not found' });
      return;
    }
    res.json(updated);
  } catch (error) {
    console.error('[Collections] Update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete collection
collectionsRouter.delete('/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    db.delete(schema.collections).where(eq(schema.collections.id, id)).run();
    res.json({ message: 'Collection deleted' });
  } catch (error) {
    console.error('[Collections] Delete error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add books to collection
collectionsRouter.post('/:id/books', (req, res) => {
  try {
    const collectionId = parseInt(req.params.id);
    const { bookIds } = req.body;

    if (!Array.isArray(bookIds) || bookIds.length === 0) {
      res.status(400).json({ error: 'bookIds array is required' });
      return;
    }

    for (const bookId of bookIds) {
      db.insert(schema.bookCollections)
        .values({ bookId, collectionId })
        .onConflictDoNothing()
        .run();
    }

    res.json({ message: 'Books added to collection' });
  } catch (error) {
    console.error('[Collections] Add books error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Remove book from collection
collectionsRouter.delete('/:id/books/:bookId', (req, res) => {
  try {
    const collectionId = parseInt(req.params.id);
    const bookId = parseInt(req.params.bookId);

    db.delete(schema.bookCollections)
      .where(
        sql`${schema.bookCollections.bookId} = ${bookId} AND ${schema.bookCollections.collectionId} = ${collectionId}`,
      )
      .run();

    res.json({ message: 'Book removed from collection' });
  } catch (error) {
    console.error('[Collections] Remove book error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
