import Database, { type Database as DatabaseType } from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

import * as usersSchema from './schema/users.js';
import * as librariesSchema from './schema/libraries.js';
import * as booksSchema from './schema/books.js';
import * as filesSchema from './schema/files.js';
import * as authorsSchema from './schema/authors.js';
import * as seriesSchema from './schema/series.js';
import * as tagsSchema from './schema/tags.js';
import * as collectionsSchema from './schema/collections.js';
import * as progressSchema from './schema/progress.js';
import * as settingsSchema from './schema/settings.js';
import * as jobsSchema from './schema/jobs.js';

export const schema = {
  ...usersSchema,
  ...librariesSchema,
  ...booksSchema,
  ...filesSchema,
  ...authorsSchema,
  ...seriesSchema,
  ...tagsSchema,
  ...collectionsSchema,
  ...progressSchema,
  ...settingsSchema,
  ...jobsSchema,
};

const DB_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'npc-shelf.db');

// Ensure directory exists
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const sqlite: DatabaseType = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
sqlite.pragma('busy_timeout = 5000');

export const db = drizzle(sqlite, { schema });
export { sqlite };

export function initializeDatabase() {
  // Create all tables
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin', 'user')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS libraries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL DEFAULT 'mixed' CHECK(type IN ('ebook', 'audiobook', 'mixed')),
      scan_enabled INTEGER NOT NULL DEFAULT 1,
      last_scanned_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS books (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      subtitle TEXT,
      description TEXT,
      language TEXT,
      publisher TEXT,
      publish_date TEXT,
      page_count INTEGER,
      isbn_10 TEXT,
      isbn_13 TEXT,
      hardcover_id TEXT,
      match_confidence REAL,
      cover_path TEXT,
      blurhash TEXT,
      audio_seconds REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      library_id INTEGER NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
      path TEXT NOT NULL UNIQUE,
      filename TEXT NOT NULL,
      format TEXT NOT NULL CHECK(format IN ('epub', 'pdf', 'mobi', 'azw3', 'm4b', 'mp3')),
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      hash_sha256 TEXT NOT NULL,
      last_modified TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS authors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      sort_name TEXT NOT NULL,
      hardcover_id TEXT,
      bio TEXT,
      photo_url TEXT
    );

    CREATE TABLE IF NOT EXISTS book_authors (
      book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      author_id INTEGER NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'author' CHECK(role IN ('author', 'narrator', 'editor')),
      PRIMARY KEY (book_id, author_id, role)
    );

    CREATE TABLE IF NOT EXISTS series (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      hardcover_id TEXT
    );

    CREATE TABLE IF NOT EXISTS book_series (
      book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      series_id INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
      position REAL,
      PRIMARY KEY (book_id, series_id)
    );

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      source TEXT NOT NULL DEFAULT 'user' CHECK(source IN ('hardcover', 'user'))
    );

    CREATE TABLE IF NOT EXISTS book_tags (
      book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (book_id, tag_id)
    );

    CREATE TABLE IF NOT EXISTS collections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS book_collections (
      book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (book_id, collection_id)
    );

    CREATE TABLE IF NOT EXISTS reading_progress (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      format TEXT NOT NULL CHECK(format IN ('epub', 'pdf')),
      cfi TEXT,
      page_number INTEGER,
      total_pages INTEGER,
      progress_percent REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS reading_progress_user_book ON reading_progress(user_id, book_id);

    CREATE TABLE IF NOT EXISTS audio_progress (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      current_track_index INTEGER NOT NULL DEFAULT 0,
      position_seconds REAL NOT NULL DEFAULT 0,
      total_elapsed_seconds REAL NOT NULL DEFAULT 0,
      total_duration_seconds REAL NOT NULL DEFAULT 0,
      playback_rate REAL NOT NULL DEFAULT 1,
      is_finished INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS audio_progress_user_book ON audio_progress(user_id, book_id);

    CREATE TABLE IF NOT EXISTS audio_tracks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      file_id INTEGER NOT NULL,
      track_index INTEGER NOT NULL,
      title TEXT,
      duration_seconds REAL NOT NULL,
      start_offset_seconds REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS audio_chapters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      start_time REAL NOT NULL,
      end_time REAL NOT NULL,
      track_index INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS metadata_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      external_id TEXT NOT NULL,
      raw_data TEXT NOT NULL,
      fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS job_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_type TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'completed', 'failed')),
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      error TEXT,
      scheduled_for TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS kindle_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kindle_email TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS kindle_deliveries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      kindle_email TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'sent', 'failed')),
      message_id TEXT,
      error TEXT,
      file_format TEXT NOT NULL,
      file_size_bytes INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- FTS5 for full-text search on books
    CREATE VIRTUAL TABLE IF NOT EXISTS books_fts USING fts5(
      title,
      subtitle,
      description,
      content='books',
      content_rowid='id'
    );

    -- Triggers to keep FTS in sync
    CREATE TRIGGER IF NOT EXISTS books_ai AFTER INSERT ON books BEGIN
      INSERT INTO books_fts(rowid, title, subtitle, description)
      VALUES (new.id, new.title, new.subtitle, new.description);
    END;

    CREATE TRIGGER IF NOT EXISTS books_ad AFTER DELETE ON books BEGIN
      INSERT INTO books_fts(books_fts, rowid, title, subtitle, description)
      VALUES ('delete', old.id, old.title, old.subtitle, old.description);
    END;

    CREATE TRIGGER IF NOT EXISTS books_au AFTER UPDATE ON books BEGIN
      INSERT INTO books_fts(books_fts, rowid, title, subtitle, description)
      VALUES ('delete', old.id, old.title, old.subtitle, old.description);
      INSERT INTO books_fts(rowid, title, subtitle, description)
      VALUES (new.id, new.title, new.subtitle, new.description);
    END;

    -- Indexes for common queries
    CREATE INDEX IF NOT EXISTS idx_files_book_id ON files(book_id);
    CREATE INDEX IF NOT EXISTS idx_files_library_id ON files(library_id);
    CREATE INDEX IF NOT EXISTS idx_files_hash ON files(hash_sha256);
    CREATE INDEX IF NOT EXISTS idx_books_title ON books(title);
    CREATE INDEX IF NOT EXISTS idx_books_hardcover_id ON books(hardcover_id);
    CREATE INDEX IF NOT EXISTS idx_job_queue_status ON job_queue(status, scheduled_for);
    CREATE INDEX IF NOT EXISTS idx_book_authors_author ON book_authors(author_id);
    CREATE INDEX IF NOT EXISTS idx_book_series_series ON book_series(series_id);

    -- Default settings
    INSERT OR IGNORE INTO settings (key, value) VALUES ('setupComplete', 'false');
    INSERT OR IGNORE INTO settings (key, value) VALUES ('metadataAutoMatch', 'true');
    INSERT OR IGNORE INTO settings (key, value) VALUES ('scanIntervalMinutes', '60');
  `);

  // Schema migrations — add columns that may not exist yet
  try { sqlite.exec(`ALTER TABLE books ADD COLUMN hardcover_slug TEXT`); } catch { /* column already exists */ }
  try { sqlite.exec(`ALTER TABLE books ADD COLUMN match_breakdown TEXT`); } catch { /* column already exists */ }
  try { sqlite.exec(`ALTER TABLE books ADD COLUMN needs_review INTEGER NOT NULL DEFAULT 0`); } catch { /* column already exists */ }
  try { sqlite.exec(`ALTER TABLE series ADD COLUMN description TEXT`); } catch { /* column already exists */ }

  // Match corrections table — stores human corrections for future auto-matching
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS match_corrections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      local_title TEXT NOT NULL,
      local_author TEXT,
      matched_external_id TEXT NOT NULL,
      matched_title TEXT NOT NULL,
      matched_author TEXT,
      provider TEXT NOT NULL DEFAULT 'hardcover',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_match_corrections_title ON match_corrections(local_title);
  `);

  console.log('[DB] Database initialized successfully');
}

export function runMigrations() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const migrationsDir = path.join(__dirname, 'migrations');

  if (!fs.existsSync(migrationsDir)) {
    console.log('[DB] No migrations directory found, skipping migrations');
    return;
  }

  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql'));
  if (files.length === 0) {
    console.log('[DB] No migration files found, skipping');
    return;
  }

  try {
    migrate(db, { migrationsFolder: migrationsDir });
    console.log('[DB] Migrations applied successfully');
  } catch (err) {
    console.error('[DB] Migration error:', err);
  }
}
