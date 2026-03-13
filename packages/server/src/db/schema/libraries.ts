import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const libraries = sqliteTable('libraries', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  path: text('path').notNull().unique(),
  type: text('type', { enum: ['ebook', 'audiobook', 'mixed'] }).notNull().default('mixed'),
  scanEnabled: integer('scan_enabled', { mode: 'boolean' }).notNull().default(true),
  lastScannedAt: text('last_scanned_at'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});
