import { sqliteTable, text, integer, real, primaryKey } from 'drizzle-orm/sqlite-core';
import { books } from './books.js';

export const series = sqliteTable('series', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  hardcoverId: text('hardcover_id'),
});

export const bookSeries = sqliteTable(
  'book_series',
  {
    bookId: integer('book_id').notNull().references(() => books.id, { onDelete: 'cascade' }),
    seriesId: integer('series_id').notNull().references(() => series.id, { onDelete: 'cascade' }),
    position: real('position'),
  },
  (table) => [primaryKey({ columns: [table.bookId, table.seriesId] })],
);
