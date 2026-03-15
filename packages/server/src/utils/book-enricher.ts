import { eq, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

/**
 * Batch-enrich books with authors and formats using 2 SQL queries instead of N+1.
 * Returns books with `authors` and `formats` arrays attached.
 */
export function enrichBooksWithMeta<T extends { id: number }>(
  books: T[],
): (T & { authors: { author: { name: string } }[]; formats: string[] })[] {
  if (books.length === 0) return [];

  const bookIds = books.map((b) => b.id);
  const idPlaceholders = sql.join(bookIds.map((id) => sql`${id}`), sql`, `);

  // Batch query all authors for these books
  const authorRows = db
    .select({
      bookId: schema.bookAuthors.bookId,
      name: schema.authors.name,
    })
    .from(schema.bookAuthors)
    .innerJoin(schema.authors, eq(schema.bookAuthors.authorId, schema.authors.id))
    .where(sql`${schema.bookAuthors.bookId} IN (${idPlaceholders})`)
    .all();

  // Batch query all file formats for these books
  const formatRows = db
    .all<{ bookId: number; format: string }>(
      sql`SELECT DISTINCT book_id as bookId, format FROM files WHERE book_id IN (${idPlaceholders})`,
    );

  // Index by bookId for O(1) lookup
  const authorsByBookId = new Map<number, { author: { name: string } }[]>();
  for (const row of authorRows) {
    let list = authorsByBookId.get(row.bookId);
    if (!list) {
      list = [];
      authorsByBookId.set(row.bookId, list);
    }
    list.push({ author: { name: row.name } });
  }

  const formatsByBookId = new Map<number, string[]>();
  for (const row of formatRows) {
    let list = formatsByBookId.get(row.bookId);
    if (!list) {
      list = [];
      formatsByBookId.set(row.bookId, list);
    }
    list.push(row.format);
  }

  return books.map((book) => ({
    ...book,
    authors: authorsByBookId.get(book.id) || [],
    formats: formatsByBookId.get(book.id) || [],
  }));
}
