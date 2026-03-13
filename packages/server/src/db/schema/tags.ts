import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';
import { books } from './books.js';

export const tags = sqliteTable('tags', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  source: text('source', { enum: ['hardcover', 'user'] }).notNull().default('user'),
});

export const bookTags = sqliteTable(
  'book_tags',
  {
    bookId: integer('book_id').notNull().references(() => books.id, { onDelete: 'cascade' }),
    tagId: integer('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.bookId, table.tagId] })],
);
