import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { stringSimilarity, normalizeForComparison } from '../utils/string-similarity.js';

export interface DuplicateGroup {
  books: { id: number; title: string; authors: string[] }[];
  method: 'hash' | 'title_author' | 'isbn';
  similarity: number;
}

const FUZZY_THRESHOLD = 0.85;

interface BookWithAuthors {
  id: number;
  title: string;
  isbn10: string | null;
  isbn13: string | null;
  authors: string[];
  normalizedKey: string;
  titlePrefix: string;
  authorIds: number[];
}

/**
 * Load all books with their authors in two queries (no N+1).
 */
function loadBooksWithAuthors(): BookWithAuthors[] {
  const allBooks = db
    .select({
      id: schema.books.id,
      title: schema.books.title,
      isbn10: schema.books.isbn10,
      isbn13: schema.books.isbn13,
    })
    .from(schema.books)
    .all();

  if (allBooks.length === 0) return [];

  // Load all book-author relationships in one query
  const allBookAuthors = db
    .select({
      bookId: schema.bookAuthors.bookId,
      authorId: schema.bookAuthors.authorId,
      authorName: schema.authors.name,
      role: schema.bookAuthors.role,
    })
    .from(schema.bookAuthors)
    .innerJoin(schema.authors, eq(schema.bookAuthors.authorId, schema.authors.id))
    .all();

  // Group authors by bookId
  const authorsByBook = new Map<number, { names: string[]; ids: number[] }>();
  for (const row of allBookAuthors) {
    let entry = authorsByBook.get(row.bookId);
    if (!entry) {
      entry = { names: [], ids: [] };
      authorsByBook.set(row.bookId, entry);
    }
    // Only use primary authors for comparison, not narrators/editors
    if (row.role === 'author') {
      entry.names.push(row.authorName);
      entry.ids.push(row.authorId);
    }
  }

  return allBooks.map((book) => {
    const entry = authorsByBook.get(book.id);
    const authors = entry?.names ?? [];
    const authorIds = entry?.ids ?? [];
    const normalizedTitle = normalizeForComparison(book.title);
    const firstAuthor = authors.length > 0 ? normalizeForComparison(authors[0]) : '';
    const normalizedKey = `${normalizedTitle} ${firstAuthor}`;
    const titlePrefix = normalizedTitle.substring(0, 3);

    return {
      id: book.id,
      title: book.title,
      isbn10: book.isbn10,
      isbn13: book.isbn13,
      authors,
      normalizedKey,
      titlePrefix,
      authorIds,
    };
  });
}

/**
 * Strategy 1: Find files with identical SHA-256 hashes belonging to different books.
 */
function detectHashDuplicates(booksMap: Map<number, BookWithAuthors>): DuplicateGroup[] {
  const files = db
    .select({
      bookId: schema.files.bookId,
      hash: schema.files.hashSha256,
    })
    .from(schema.files)
    .all();

  // Group files by hash
  const hashToBooks = new Map<string, Set<number>>();
  for (const file of files) {
    let bookIds = hashToBooks.get(file.hash);
    if (!bookIds) {
      bookIds = new Set();
      hashToBooks.set(file.hash, bookIds);
    }
    bookIds.add(file.bookId);
  }

  const groups: DuplicateGroup[] = [];
  for (const [, bookIds] of hashToBooks) {
    if (bookIds.size < 2) continue;

    const books = [...bookIds]
      .map((id) => booksMap.get(id))
      .filter((b): b is BookWithAuthors => b !== undefined)
      .map((b) => ({ id: b.id, title: b.title, authors: b.authors }));

    if (books.length >= 2) {
      groups.push({ books, method: 'hash', similarity: 1 });
    }
  }

  return groups;
}

/**
 * Strategy 2: Fuzzy match on normalized title + first author.
 * Only compares pairs that share at least one authorId or have the same
 * first 3 characters of normalized title, to avoid full O(n^2).
 */
function detectTitleAuthorDuplicates(allBooks: BookWithAuthors[]): DuplicateGroup[] {
  if (allBooks.length < 2) return [];

  // Build indexes for candidate pair generation
  const byAuthorId = new Map<number, number[]>(); // authorId -> book indexes
  const byTitlePrefix = new Map<string, number[]>(); // prefix -> book indexes

  for (let i = 0; i < allBooks.length; i++) {
    const book = allBooks[i];

    for (const aid of book.authorIds) {
      let list = byAuthorId.get(aid);
      if (!list) {
        list = [];
        byAuthorId.set(aid, list);
      }
      list.push(i);
    }

    if (book.titlePrefix.length >= 3) {
      let list = byTitlePrefix.get(book.titlePrefix);
      if (!list) {
        list = [];
        byTitlePrefix.set(book.titlePrefix, list);
      }
      list.push(i);
    }
  }

  // Collect candidate pairs (deduplicated)
  const candidatePairs = new Set<string>();

  function addPairsFromList(indexes: number[]) {
    for (let a = 0; a < indexes.length; a++) {
      for (let b = a + 1; b < indexes.length; b++) {
        const lo = Math.min(indexes[a], indexes[b]);
        const hi = Math.max(indexes[a], indexes[b]);
        candidatePairs.add(`${lo}:${hi}`);
      }
    }
  }

  for (const [, indexes] of byAuthorId) {
    if (indexes.length > 1) addPairsFromList(indexes);
  }
  for (const [, indexes] of byTitlePrefix) {
    if (indexes.length > 1) addPairsFromList(indexes);
  }

  // Evaluate candidates
  const groups: DuplicateGroup[] = [];
  for (const pairKey of candidatePairs) {
    const [iStr, jStr] = pairKey.split(':');
    const i = Number.parseInt(iStr, 10);
    const j = Number.parseInt(jStr, 10);
    const bookA = allBooks[i];
    const bookB = allBooks[j];

    const sim = stringSimilarity(bookA.normalizedKey, bookB.normalizedKey);
    if (sim >= FUZZY_THRESHOLD) {
      groups.push({
        books: [
          { id: bookA.id, title: bookA.title, authors: bookA.authors },
          { id: bookB.id, title: bookB.title, authors: bookB.authors },
        ],
        method: 'title_author',
        similarity: Math.round(sim * 1000) / 1000,
      });
    }
  }

  return groups;
}

/**
 * Strategy 3: Exact ISBN match across different book records.
 */
function detectIsbnDuplicates(allBooks: BookWithAuthors[]): DuplicateGroup[] {
  const isbn13Map = new Map<string, BookWithAuthors[]>();
  const isbn10Map = new Map<string, BookWithAuthors[]>();

  for (const book of allBooks) {
    if (book.isbn13) {
      let list = isbn13Map.get(book.isbn13);
      if (!list) {
        list = [];
        isbn13Map.set(book.isbn13, list);
      }
      list.push(book);
    }
    if (book.isbn10) {
      let list = isbn10Map.get(book.isbn10);
      if (!list) {
        list = [];
        isbn10Map.set(book.isbn10, list);
      }
      list.push(book);
    }
  }

  const groups: DuplicateGroup[] = [];
  const seen = new Set<string>();

  function addGroup(books: BookWithAuthors[]) {
    if (books.length < 2) return;
    const key = books
      .map((b) => b.id)
      .sort((a, b) => a - b)
      .join(',');
    if (seen.has(key)) return;
    seen.add(key);

    groups.push({
      books: books.map((b) => ({ id: b.id, title: b.title, authors: b.authors })),
      method: 'isbn',
      similarity: 1,
    });
  }

  for (const [, books] of isbn13Map) addGroup(books);
  for (const [, books] of isbn10Map) addGroup(books);

  return groups;
}

/**
 * Create a canonical key for a group of book IDs (sorted, comma-separated).
 */
function groupKey(bookIds: number[]): string {
  return [...bookIds].sort((a, b) => a - b).join(',');
}

/**
 * Detect duplicate books across three strategies: file hash, title+author fuzzy,
 * and ISBN collision. When the same pair is found by multiple methods, keep only
 * the entry with the highest similarity score.
 */
export function detectDuplicates(): DuplicateGroup[] {
  const allBooks = loadBooksWithAuthors();
  if (allBooks.length < 2) return [];

  const booksMap = new Map<number, BookWithAuthors>();
  for (const book of allBooks) {
    booksMap.set(book.id, book);
  }

  const hashGroups = detectHashDuplicates(booksMap);
  const titleAuthorGroups = detectTitleAuthorDuplicates(allBooks);
  const isbnGroups = detectIsbnDuplicates(allBooks);

  // Deduplicate: for the same set of book IDs, keep the highest similarity
  const bestByKey = new Map<string, DuplicateGroup>();

  for (const group of [...hashGroups, ...isbnGroups, ...titleAuthorGroups]) {
    const key = groupKey(group.books.map((b) => b.id));
    const existing = bestByKey.get(key);
    if (!existing || group.similarity > existing.similarity) {
      bestByKey.set(key, group);
    }
  }

  return [...bestByKey.values()];
}
