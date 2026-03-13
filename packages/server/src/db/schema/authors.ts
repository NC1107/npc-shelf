import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';
import { books } from './books.js';

export const authors = sqliteTable('authors', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  sortName: text('sort_name').notNull(),
  hardcoverId: text('hardcover_id'),
  bio: text('bio'),
  photoUrl: text('photo_url'),
});

export const bookAuthors = sqliteTable(
  'book_authors',
  {
    bookId: integer('book_id').notNull().references(() => books.id, { onDelete: 'cascade' }),
    authorId: integer('author_id').notNull().references(() => authors.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['author', 'narrator', 'editor'] }).notNull().default('author'),
  },
  (table) => [primaryKey({ columns: [table.bookId, table.authorId, table.role] })],
);
