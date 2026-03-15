import { Router } from 'express';
import { eq, inArray, sql, desc } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { opdsAuthMiddleware } from '../middleware/opds-auth.js';
import {
  generateRootFeed,
  generateBooksFeed,
  generateNavFeed,
  generateOpenSearchDescriptor,
} from '../services/opds.js';

export const opdsRouter = Router();

// All OPDS routes use HTTP Basic auth
opdsRouter.use(opdsAuthMiddleware);

const PAGE_SIZE = 25;

function getBookEntries(bookRows: any[]) {
  return bookRows.map((book) => {
    const authors = db
      .select({ name: schema.authors.name, role: schema.bookAuthors.role })
      .from(schema.bookAuthors)
      .innerJoin(schema.authors, eq(schema.bookAuthors.authorId, schema.authors.id))
      .where(eq(schema.bookAuthors.bookId, book.id))
      .all();

    const files = db
      .select({
        id: schema.files.id,
        format: schema.files.format,
        mimeType: schema.files.mimeType,
        sizeBytes: schema.files.sizeBytes,
      })
      .from(schema.files)
      .where(eq(schema.files.bookId, book.id))
      .all();

    return { ...book, authors, files };
  });
}

// Root navigation feed
opdsRouter.get('/', (_req, res) => {
  res.type('application/atom+xml;profile=opds-catalog;kind=navigation');
  res.send(generateRootFeed());
});

// OpenSearch descriptor
opdsRouter.get('/opensearch.xml', (_req, res) => {
  res.type('application/opensearchdescription+xml');
  res.send(generateOpenSearchDescriptor());
});

// Recent books (acquisition feed, paginated)
opdsRouter.get('/recent', (req, res) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page as string) || 1);
    const offset = (page - 1) * PAGE_SIZE;

    const total = db.select({ count: sql<number>`count(*)` }).from(schema.books).get()?.count || 0;
    const totalPages = Math.ceil(total / PAGE_SIZE);

    const bookRows = db
      .select()
      .from(schema.books)
      .orderBy(desc(schema.books.createdAt))
      .limit(PAGE_SIZE)
      .offset(offset)
      .all();

    const books = getBookEntries(bookRows);

    res.type('application/atom+xml;profile=opds-catalog;kind=acquisition');
    res.send(generateBooksFeed('urn:npc-shelf:recent', 'Recent Books', '/opds/recent', books, page, totalPages));
  } catch (error) {
    console.error('[OPDS] Recent error:', error);
    res.status(500).send('Internal server error');
  }
});

// Authors list (navigation feed)
opdsRouter.get('/authors', (_req, res) => {
  try {
    const authors = db
      .select({ id: schema.authors.id, name: schema.authors.name })
      .from(schema.authors)
      .orderBy(schema.authors.sortName)
      .all();

    const entries = authors.map((a) => ({
      id: `urn:npc-shelf:author:${a.id}`,
      title: a.name,
      href: `/opds/authors/${a.id}`,
      content: `Books by ${a.name}`,
      kind: 'acquisition',
    }));

    res.type('application/atom+xml;profile=opds-catalog;kind=navigation');
    res.send(generateNavFeed('urn:npc-shelf:authors', 'Authors', '/opds/authors', entries));
  } catch (error) {
    console.error('[OPDS] Authors error:', error);
    res.status(500).send('Internal server error');
  }
});

// Books by author (acquisition feed)
opdsRouter.get('/authors/:id', (req, res) => {
  try {
    const authorId = Number.parseInt(req.params.id);
    const author = db.select().from(schema.authors).where(eq(schema.authors.id, authorId)).get();
    if (!author) {
      res.status(404).send('Author not found');
      return;
    }

    const bookIds = db
      .select({ bookId: schema.bookAuthors.bookId })
      .from(schema.bookAuthors)
      .where(eq(schema.bookAuthors.authorId, authorId))
      .all()
      .map((r) => r.bookId);

    const bookRows = bookIds.length > 0
      ? db.select().from(schema.books).where(inArray(schema.books.id, bookIds)).all()
      : [];

    const books = getBookEntries(bookRows);

    res.type('application/atom+xml;profile=opds-catalog;kind=acquisition');
    res.send(generateBooksFeed(
      `urn:npc-shelf:author:${authorId}`,
      `Books by ${author.name}`,
      `/opds/authors/${authorId}`,
      books,
      1,
      1,
    ));
  } catch (error) {
    console.error('[OPDS] Author books error:', error);
    res.status(500).send('Internal server error');
  }
});

// Series list (navigation feed)
opdsRouter.get('/series', (_req, res) => {
  try {
    const seriesList = db
      .select({ id: schema.series.id, name: schema.series.name })
      .from(schema.series)
      .orderBy(schema.series.name)
      .all();

    const entries = seriesList.map((s) => ({
      id: `urn:npc-shelf:series:${s.id}`,
      title: s.name,
      href: `/opds/series/${s.id}`,
      content: `Books in ${s.name}`,
      kind: 'acquisition',
    }));

    res.type('application/atom+xml;profile=opds-catalog;kind=navigation');
    res.send(generateNavFeed('urn:npc-shelf:series', 'Series', '/opds/series', entries));
  } catch (error) {
    console.error('[OPDS] Series error:', error);
    res.status(500).send('Internal server error');
  }
});

// Books in series (acquisition feed)
opdsRouter.get('/series/:id', (req, res) => {
  try {
    const seriesId = Number.parseInt(req.params.id);
    const series = db.select().from(schema.series).where(eq(schema.series.id, seriesId)).get();
    if (!series) {
      res.status(404).send('Series not found');
      return;
    }

    const bookIds = db
      .select({ bookId: schema.bookSeries.bookId })
      .from(schema.bookSeries)
      .where(eq(schema.bookSeries.seriesId, seriesId))
      .all()
      .map((r) => r.bookId);

    const bookRows = bookIds.length > 0
      ? db.select().from(schema.books).where(inArray(schema.books.id, bookIds)).all()
      : [];

    const books = getBookEntries(bookRows);

    res.type('application/atom+xml;profile=opds-catalog;kind=acquisition');
    res.send(generateBooksFeed(
      `urn:npc-shelf:series:${seriesId}`,
      series.name,
      `/opds/series/${seriesId}`,
      books,
      1,
      1,
    ));
  } catch (error) {
    console.error('[OPDS] Series books error:', error);
    res.status(500).send('Internal server error');
  }
});

// Search (acquisition feed)
opdsRouter.get('/search', (req, res) => {
  try {
    const query = (req.query.q as string) || '';
    if (!query) {
      res.type('application/atom+xml;profile=opds-catalog;kind=acquisition');
      res.send(generateBooksFeed('urn:npc-shelf:search', 'Search Results', '/opds/search', [], 1, 1));
      return;
    }

    // Use FTS5 for search
    const bookRows = db
      .select({
        id: schema.books.id,
        title: schema.books.title,
        subtitle: schema.books.subtitle,
        description: schema.books.description,
        language: schema.books.language,
        isbn13: schema.books.isbn13,
        coverPath: schema.books.coverPath,
        createdAt: schema.books.createdAt,
        updatedAt: schema.books.updatedAt,
      })
      .from(schema.books)
      .where(
        sql`${schema.books.id} IN (SELECT rowid FROM books_fts WHERE books_fts MATCH ${query + '*'})`,
      )
      .limit(50)
      .all();

    const books = getBookEntries(bookRows);

    res.type('application/atom+xml;profile=opds-catalog;kind=acquisition');
    res.send(generateBooksFeed(
      'urn:npc-shelf:search',
      `Search: ${query}`,
      `/opds/search?q=${encodeURIComponent(query)}`,
      books,
      1,
      1,
    ));
  } catch (error) {
    console.error('[OPDS] Search error:', error);
    res.status(500).send('Internal server error');
  }
});
