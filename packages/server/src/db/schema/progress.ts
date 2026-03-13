import { sqliteTable, text, integer, real, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { books } from './books.js';
import { users } from './users.js';

export const readingProgress = sqliteTable(
  'reading_progress',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    bookId: integer('book_id').notNull().references(() => books.id, { onDelete: 'cascade' }),
    format: text('format', { enum: ['epub', 'pdf'] }).notNull(),
    cfi: text('cfi'),
    pageNumber: integer('page_number'),
    totalPages: integer('total_pages'),
    progressPercent: real('progress_percent').notNull().default(0),
    updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
  },
  (table) => [uniqueIndex('reading_progress_user_book').on(table.userId, table.bookId)],
);

export const audioProgress = sqliteTable(
  'audio_progress',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    bookId: integer('book_id').notNull().references(() => books.id, { onDelete: 'cascade' }),
    currentTrackIndex: integer('current_track_index').notNull().default(0),
    positionSeconds: real('position_seconds').notNull().default(0),
    totalElapsedSeconds: real('total_elapsed_seconds').notNull().default(0),
    totalDurationSeconds: real('total_duration_seconds').notNull().default(0),
    playbackRate: real('playback_rate').notNull().default(1),
    isFinished: integer('is_finished', { mode: 'boolean' }).notNull().default(false),
    updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
  },
  (table) => [uniqueIndex('audio_progress_user_book').on(table.userId, table.bookId)],
);

export const audioTracks = sqliteTable('audio_tracks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  bookId: integer('book_id').notNull().references(() => books.id, { onDelete: 'cascade' }),
  fileId: integer('file_id').notNull(),
  trackIndex: integer('track_index').notNull(),
  title: text('title'),
  durationSeconds: real('duration_seconds').notNull(),
  startOffsetSeconds: real('start_offset_seconds').notNull().default(0),
});

export const audioChapters = sqliteTable('audio_chapters', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  bookId: integer('book_id').notNull().references(() => books.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  startTime: real('start_time').notNull(),
  endTime: real('end_time').notNull(),
  trackIndex: integer('track_index').notNull(),
});
