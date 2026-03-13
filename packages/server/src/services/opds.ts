import { create } from 'xmlbuilder2';
import { MIME_TYPES } from '@npc-shelf/shared';

interface OpdsBookEntry {
  id: number;
  title: string;
  subtitle?: string | null;
  description?: string | null;
  language?: string | null;
  isbn13?: string | null;
  coverPath?: string | null;
  createdAt: string;
  updatedAt: string;
  authors: { name: string; role: string }[];
  files: { id: number; format: string; mimeType: string; sizeBytes: number }[];
}

const ATOM_NS = 'http://www.w3.org/2005/Atom';
const OPDS_NS = 'http://opds-spec.org/2010/catalog';
const DC_NS = 'http://purl.org/dc/terms/';

function createFeed(id: string, title: string, selfHref: string, kind: 'navigation' | 'acquisition') {
  const doc = create({ version: '1.0', encoding: 'UTF-8' })
    .ele(ATOM_NS, 'feed')
    .att('xmlns:opds', OPDS_NS)
    .att('xmlns:dc', DC_NS);

  doc.ele('id').txt(id);
  doc.ele('title').txt(title);
  doc.ele('updated').txt(new Date().toISOString());

  doc.ele('link')
    .att('rel', 'self')
    .att('href', selfHref)
    .att('type', `application/atom+xml;profile=opds-catalog;kind=${kind}`);

  doc.ele('link')
    .att('rel', 'start')
    .att('href', '/opds')
    .att('type', 'application/atom+xml;profile=opds-catalog;kind=navigation');

  return doc;
}

function addNavEntry(feed: any, id: string, title: string, href: string, content: string, kind = 'navigation') {
  const entry = feed.ele('entry');
  entry.ele('title').txt(title);
  entry.ele('id').txt(id);
  entry.ele('link')
    .att('href', href)
    .att('type', `application/atom+xml;profile=opds-catalog;kind=${kind}`);
  entry.ele('updated').txt(new Date().toISOString());
  entry.ele('content').att('type', 'text').txt(content);
}

function addBookEntry(feed: any, book: OpdsBookEntry) {
  const entry = feed.ele('entry');
  entry.ele('title').txt(book.title);
  entry.ele('id').txt(`urn:npc-shelf:book:${book.id}`);
  entry.ele('updated').txt(book.updatedAt);

  if (book.description) {
    entry.ele('summary').att('type', 'text').txt(
      book.description.length > 500 ? book.description.slice(0, 500) + '...' : book.description,
    );
  }

  for (const author of book.authors) {
    const authorEle = entry.ele('author');
    authorEle.ele('name').txt(author.name);
  }

  if (book.language) {
    entry.ele(DC_NS, 'language').txt(book.language);
  }

  if (book.isbn13) {
    entry.ele(DC_NS, 'identifier').txt(`urn:isbn:${book.isbn13}`);
  }

  // Cover image links
  if (book.coverPath) {
    entry.ele('link')
      .att('rel', 'http://opds-spec.org/image')
      .att('href', `/api/books/${book.id}/cover/medium`)
      .att('type', 'image/webp');
    entry.ele('link')
      .att('rel', 'http://opds-spec.org/image/thumbnail')
      .att('href', `/api/books/${book.id}/cover/thumb`)
      .att('type', 'image/webp');
  }

  // Acquisition links (download files)
  for (const file of book.files) {
    entry.ele('link')
      .att('rel', 'http://opds-spec.org/acquisition')
      .att('href', `/api/books/${book.id}/file?format=${file.format}`)
      .att('type', file.mimeType)
      .att('title', file.format.toUpperCase());
  }
}

function addPagination(feed: any, basePath: string, page: number, totalPages: number) {
  if (page > 1) {
    feed.ele('link')
      .att('rel', 'previous')
      .att('href', `${basePath}?page=${page - 1}`)
      .att('type', 'application/atom+xml;profile=opds-catalog;kind=acquisition');
  }
  if (page < totalPages) {
    feed.ele('link')
      .att('rel', 'next')
      .att('href', `${basePath}?page=${page + 1}`)
      .att('type', 'application/atom+xml;profile=opds-catalog;kind=acquisition');
  }
}

export function generateRootFeed(): string {
  const feed = createFeed('urn:npc-shelf:root', 'NPC-Shelf', '/opds', 'navigation');

  // Search link
  feed.ele('link')
    .att('rel', 'search')
    .att('href', '/opds/opensearch.xml')
    .att('type', 'application/opensearchdescription+xml');

  addNavEntry(feed, 'urn:npc-shelf:recent', 'Recent Books', '/opds/recent', 'Recently added books', 'acquisition');
  addNavEntry(feed, 'urn:npc-shelf:authors', 'Authors', '/opds/authors', 'Browse by author');
  addNavEntry(feed, 'urn:npc-shelf:series', 'Series', '/opds/series', 'Browse by series');

  return feed.end({ prettyPrint: true });
}

export function generateBooksFeed(
  id: string,
  title: string,
  selfHref: string,
  books: OpdsBookEntry[],
  page: number,
  totalPages: number,
): string {
  const feed = createFeed(id, title, selfHref, 'acquisition');
  addPagination(feed, selfHref.split('?')[0]!, page, totalPages);

  for (const book of books) {
    addBookEntry(feed, book);
  }

  return feed.end({ prettyPrint: true });
}

export function generateNavFeed(
  id: string,
  title: string,
  selfHref: string,
  entries: { id: string; title: string; href: string; content: string; kind?: string }[],
): string {
  const feed = createFeed(id, title, selfHref, 'navigation');

  for (const entry of entries) {
    addNavEntry(feed, entry.id, entry.title, entry.href, entry.content, entry.kind);
  }

  return feed.end({ prettyPrint: true });
}

export function generateOpenSearchDescriptor(): string {
  const doc = create({ version: '1.0', encoding: 'UTF-8' })
    .ele('http://a9.com/-/spec/opensearch/1.1/', 'OpenSearchDescription');

  doc.ele('ShortName').txt('NPC-Shelf');
  doc.ele('Description').txt('Search NPC-Shelf library');
  doc.ele('Url')
    .att('type', 'application/atom+xml;profile=opds-catalog;kind=acquisition')
    .att('template', '/opds/search?q={searchTerms}');

  return doc.end({ prettyPrint: true });
}
