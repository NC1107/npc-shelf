import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const books = sqliteTable('books', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  subtitle: text('subtitle'),
  description: text('description'),
  language: text('language'),
  publisher: text('publisher'),
  publishDate: text('publish_date'),
  pageCount: integer('page_count'),
  isbn10: text('isbn_10'),
  isbn13: text('isbn_13'),
  hardcoverId: text('hardcover_id'),
  hardcoverSlug: text('hardcover_slug'),
  matchConfidence: real('match_confidence'),
  coverPath: text('cover_path'),
  blurhash: text('blurhash'),
  audioSeconds: real('audio_seconds'),
  matchBreakdown: text('match_breakdown'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
});
