import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { users } from './users.js';
import { books } from './books.js';

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
});

export const metadataCache = sqliteTable('metadata_cache', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  bookId: integer('book_id').notNull().references(() => books.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  externalId: text('external_id').notNull(),
  rawData: text('raw_data').notNull(),
  fetchedAt: text('fetched_at').notNull().default(sql`(datetime('now'))`),
});

export const kindleSettings = sqliteTable('kindle_settings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  kindleEmail: text('kindle_email').notNull(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

export const kindleDeliveries = sqliteTable('kindle_deliveries', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  bookId: integer('book_id').notNull().references(() => books.id, { onDelete: 'cascade' }),
  kindleEmail: text('kindle_email').notNull(),
  status: text('status', { enum: ['pending', 'sent', 'failed'] }).notNull().default('pending'),
  messageId: text('message_id'),
  error: text('error'),
  fileFormat: text('file_format').notNull(),
  fileSizeBytes: integer('file_size_bytes').notNull(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

export const matchCorrections = sqliteTable('match_corrections', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  localTitle: text('local_title').notNull(),
  localAuthor: text('local_author'),
  matchedExternalId: text('matched_external_id').notNull(),
  matchedTitle: text('matched_title').notNull(),
  matchedAuthor: text('matched_author'),
  provider: text('provider').notNull().default('hardcover'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});
