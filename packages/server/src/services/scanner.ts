import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { SUPPORTED_FORMATS, MIME_TYPES } from '@npc-shelf/shared';
import { parseFilename, toSortName } from '../utils/filename-parser.js';
import type { ScanStatus } from '@npc-shelf/shared';

const AUDIO_PARTIAL_HASH_SIZE = 64 * 1024; // 64KB

export async function scanLibrary(libraryId: number): Promise<ScanStatus> {
  const library = db.select().from(schema.libraries).where(eq(schema.libraries.id, libraryId)).get();
  if (!library) {
    throw new Error(`Library ${libraryId} not found`);
  }

  const status: ScanStatus = {
    libraryId,
    status: 'scanning',
    filesFound: 0,
    filesProcessed: 0,
    booksAdded: 0,
    booksUpdated: 0,
    errors: [],
    startedAt: new Date().toISOString(),
    completedAt: null,
  };

  try {
    const files = findSupportedFiles(library.path);
    status.filesFound = files.length;

    for (const filePath of files) {
      try {
        await processFile(filePath, libraryId);
        status.filesProcessed++;
        status.booksAdded++;
      } catch (err: any) {
        status.errors.push(`${filePath}: ${err.message}`);
      }
    }

    // Update last scanned time
    db.update(schema.libraries)
      .set({ lastScannedAt: new Date().toISOString() })
      .where(eq(schema.libraries.id, libraryId))
      .run();

    status.status = 'complete';
    status.completedAt = new Date().toISOString();
  } catch (err: any) {
    status.status = 'error';
    status.errors.push(err.message);
  }

  return status;
}

function findSupportedFiles(dirPath: string): string[] {
  const results: string[] = [];
  const extensions = SUPPORTED_FORMATS.map((f) => `.${f}`);

  function walk(dir: string) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (extensions.includes(ext)) {
          results.push(fullPath);
        }
      }
    }
  }

  walk(dirPath);
  return results;
}

async function processFile(filePath: string, libraryId: number): Promise<void> {
  const stat = fs.statSync(filePath);
  const ext = path.extname(filePath).toLowerCase().slice(1);
  const format = ext as 'epub' | 'pdf' | 'mobi' | 'azw3' | 'm4b' | 'mp3';
  const mimeType = MIME_TYPES[format] || 'application/octet-stream';

  // Check if file already indexed
  const existingFile = db
    .select()
    .from(schema.files)
    .where(eq(schema.files.path, filePath))
    .get();

  if (existingFile) {
    // Check if modified
    const lastMod = stat.mtime.toISOString();
    if (existingFile.lastModified === lastMod) return;

    // File was modified — update hash and re-process
    const hash = await computeHash(filePath, format);
    db.update(schema.files)
      .set({ hashSha256: hash, lastModified: lastMod, sizeBytes: stat.size })
      .where(eq(schema.files.id, existingFile.id))
      .run();
    return;
  }

  // Compute hash
  const hash = await computeHash(filePath, format);

  // Check for duplicate by hash
  const duplicate = db
    .select()
    .from(schema.files)
    .where(eq(schema.files.hashSha256, hash))
    .get();

  if (duplicate) return;

  // Parse metadata from filename
  const dirPath = path.dirname(filePath);
  const parsed = parseFilename(path.basename(filePath), dirPath);

  // Create book record
  const book = db
    .insert(schema.books)
    .values({ title: parsed.title })
    .returning()
    .get();

  // Create file record
  db.insert(schema.files)
    .values({
      bookId: book.id,
      libraryId,
      path: filePath,
      filename: path.basename(filePath),
      format,
      mimeType,
      sizeBytes: stat.size,
      hashSha256: hash,
      lastModified: stat.mtime.toISOString(),
    })
    .run();

  // Create author if parsed
  if (parsed.author) {
    const existingAuthor = db
      .select()
      .from(schema.authors)
      .where(eq(schema.authors.name, parsed.author))
      .get();

    const authorId = existingAuthor
      ? existingAuthor.id
      : db
          .insert(schema.authors)
          .values({ name: parsed.author, sortName: toSortName(parsed.author) })
          .returning()
          .get().id;

    db.insert(schema.bookAuthors)
      .values({ bookId: book.id, authorId, role: 'author' })
      .onConflictDoNothing()
      .run();
  }

  // Create series if parsed
  if (parsed.seriesName) {
    const existingSeries = db
      .select()
      .from(schema.series)
      .where(eq(schema.series.name, parsed.seriesName))
      .get();

    const seriesId = existingSeries
      ? existingSeries.id
      : db.insert(schema.series).values({ name: parsed.seriesName }).returning().get().id;

    db.insert(schema.bookSeries)
      .values({ bookId: book.id, seriesId, position: parsed.seriesPosition })
      .onConflictDoNothing()
      .run();
  }
}

async function computeHash(filePath: string, format: string): Promise<string> {
  const isAudio = ['m4b', 'mp3'].includes(format);
  const stat = fs.statSync(filePath);

  if (isAudio && stat.size > AUDIO_PARTIAL_HASH_SIZE * 4) {
    // Partial hash for large audio files: first + last 64KB
    const hash = crypto.createHash('sha256');
    const fd = fs.openSync(filePath, 'r');

    const buf1 = Buffer.alloc(AUDIO_PARTIAL_HASH_SIZE);
    fs.readSync(fd, buf1, 0, AUDIO_PARTIAL_HASH_SIZE, 0);
    hash.update(buf1);

    const buf2 = Buffer.alloc(AUDIO_PARTIAL_HASH_SIZE);
    fs.readSync(fd, buf2, 0, AUDIO_PARTIAL_HASH_SIZE, stat.size - AUDIO_PARTIAL_HASH_SIZE);
    hash.update(buf2);

    fs.closeSync(fd);
    return hash.digest('hex');
  }

  // Full hash for ebooks and small files
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (data) => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}
