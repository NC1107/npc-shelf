import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { books } from './books.js';
import { libraries } from './libraries.js';

export const files = sqliteTable('files', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  bookId: integer('book_id').notNull().references(() => books.id, { onDelete: 'cascade' }),
  libraryId: integer('library_id').notNull().references(() => libraries.id, { onDelete: 'cascade' }),
  path: text('path').notNull().unique(),
  filename: text('filename').notNull(),
  format: text('format', { enum: ['epub', 'pdf', 'mobi', 'azw3', 'm4b', 'mp3'] }).notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  hashSha256: text('hash_sha256').notNull(),
  lastModified: text('last_modified').notNull(),
  isCompanion: integer('is_companion').notNull().default(0),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});
