import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { eq, sql, and, notInArray } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { SUPPORTED_FORMATS, MIME_TYPES, SUPPORTED_EBOOK_FORMATS, SUPPORTED_AUDIO_FORMATS } from '@npc-shelf/shared';
import { parseFilename, toSortName } from '../utils/filename-parser.js';
import { parseEpub } from './epub-parser.js';
import { parseAudioMetadata } from './audio-parser.js';
import { extractAndCacheCover } from './cover.js';
import type { ScanStatus } from '@npc-shelf/shared';

const AUDIO_PARTIAL_HASH_SIZE = 64 * 1024; // 64KB

// Shared scan status map — read by the SSE endpoint
export const activeScanStatuses = new Map<number, ScanStatus>();

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
  activeScanStatuses.set(libraryId, status);

  try {
    // 1. Find all supported files on disk
    const diskFiles = findSupportedFiles(library.path);
    status.filesFound = diskFiles.length;

    // 2. Get all currently indexed file paths for this library
    const indexedFiles = db
      .select({ id: schema.files.id, path: schema.files.path })
      .from(schema.files)
      .where(eq(schema.files.libraryId, libraryId))
      .all();
    const indexedPaths = new Set(indexedFiles.map((f) => f.path));

    // 3. Detect removed files — paths in DB but no longer on disk
    const diskPathSet = new Set(diskFiles);
    const removedFiles = indexedFiles.filter((f) => !diskPathSet.has(f.path));
    for (const removed of removedFiles) {
      // Get the book for this file
      const file = db.select().from(schema.files).where(eq(schema.files.id, removed.id)).get();
      if (file) {
        // Delete the file record
        db.delete(schema.files).where(eq(schema.files.id, removed.id)).run();
        // If this was the only file for the book, delete the book too
        const remainingFiles = db
          .select({ id: schema.files.id })
          .from(schema.files)
          .where(eq(schema.files.bookId, file.bookId))
          .all();
        if (remainingFiles.length === 0) {
          db.delete(schema.books).where(eq(schema.books.id, file.bookId)).run();
        }
      }
    }

    // 4. Process each file on disk
    for (const filePath of diskFiles) {
      try {
        const result = await processFile(filePath, libraryId);
        status.filesProcessed++;
        if (result === 'added') status.booksAdded++;
        else if (result === 'updated') status.booksUpdated++;
      } catch (err: any) {
        status.errors.push(`${path.basename(filePath)}: ${err.message}`);
        status.filesProcessed++;
      }
      // Update the shared status for real-time progress
      activeScanStatuses.set(libraryId, { ...status });
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

  activeScanStatuses.set(libraryId, { ...status });

  // Clean up after a delay so the client can read the final status
  setTimeout(() => activeScanStatuses.delete(libraryId), 30000);

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

type ProcessResult = 'added' | 'updated' | 'skipped';

async function processFile(filePath: string, libraryId: number): Promise<ProcessResult> {
  const stat = fs.statSync(filePath);
  const ext = path.extname(filePath).toLowerCase().slice(1);
  const format = ext as 'epub' | 'pdf' | 'mobi' | 'azw3' | 'm4b' | 'mp3';
  const mimeType = MIME_TYPES[format] || 'application/octet-stream';
  const lastMod = stat.mtime.toISOString();

  // Check if file already indexed
  const existingFile = db
    .select()
    .from(schema.files)
    .where(eq(schema.files.path, filePath))
    .get();

  if (existingFile) {
    // Unchanged — skip
    if (existingFile.lastModified === lastMod && existingFile.sizeBytes === stat.size) {
      return 'skipped';
    }

    // File was modified — re-hash and re-extract metadata
    const hash = await computeHash(filePath, format);
    db.update(schema.files)
      .set({ hashSha256: hash, lastModified: lastMod, sizeBytes: stat.size })
      .where(eq(schema.files.id, existingFile.id))
      .run();

    // Re-extract metadata and update the book
    await extractAndUpdateMetadata(filePath, format, existingFile.bookId);
    return 'updated';
  }

  // Compute hash for new file
  const hash = await computeHash(filePath, format);

  // Check for duplicate by hash
  const duplicate = db
    .select()
    .from(schema.files)
    .where(eq(schema.files.hashSha256, hash))
    .get();

  if (duplicate) {
    // Same content exists — add as additional file for same book
    db.insert(schema.files)
      .values({
        bookId: duplicate.bookId,
        libraryId,
        path: filePath,
        filename: path.basename(filePath),
        format,
        mimeType,
        sizeBytes: stat.size,
        hashSha256: hash,
        lastModified: lastMod,
      })
      .run();
    return 'skipped';
  }

  // --- New book ---

  // Parse metadata from filename as baseline
  const dirPath = path.dirname(filePath);
  const parsed = parseFilename(path.basename(filePath), dirPath);

  // Extract embedded metadata
  const embedded = await extractEmbeddedMetadata(filePath, format);

  // Merge: embedded takes priority over filename-parsed
  const title = embedded.title || parsed.title;
  const authorName = embedded.author || parsed.author;
  const description = embedded.description || null;
  const language = embedded.language || null;
  const publisher = embedded.publisher || null;
  const publishDate = embedded.date || null;
  const isbn = embedded.isbn || null;
  const subjects = embedded.subjects || [];
  const duration = embedded.duration || null;

  // Create book record
  const book = db
    .insert(schema.books)
    .values({
      title,
      description,
      language,
      publisher,
      publishDate,
      isbn13: isbn && isbn.length === 13 ? isbn : null,
      isbn10: isbn && isbn.length === 10 ? isbn : null,
      audioSeconds: duration,
    })
    .returning()
    .get();

  // Create file record
  const file = db
    .insert(schema.files)
    .values({
      bookId: book.id,
      libraryId,
      path: filePath,
      filename: path.basename(filePath),
      format,
      mimeType,
      sizeBytes: stat.size,
      hashSha256: hash,
      lastModified: lastMod,
    })
    .returning()
    .get();

  // Create author
  if (authorName) {
    const authorId = findOrCreateAuthor(authorName);
    db.insert(schema.bookAuthors)
      .values({ bookId: book.id, authorId, role: 'author' })
      .onConflictDoNothing()
      .run();
  }

  // Additional creators from embedded metadata
  if (embedded.creators) {
    for (const creator of embedded.creators) {
      if (creator.name === authorName) continue; // already added
      const creatorId = findOrCreateAuthor(creator.name);
      db.insert(schema.bookAuthors)
        .values({ bookId: book.id, authorId: creatorId, role: creator.role as 'author' | 'narrator' | 'editor' })
        .onConflictDoNothing()
        .run();
    }
  }

  // Create series from filename
  if (parsed.seriesName) {
    const seriesId = findOrCreateSeries(parsed.seriesName);
    db.insert(schema.bookSeries)
      .values({ bookId: book.id, seriesId, position: parsed.seriesPosition })
      .onConflictDoNothing()
      .run();
  }

  // Create tags from subjects
  for (const subject of subjects) {
    const tagId = findOrCreateTag(subject, 'user');
    db.insert(schema.bookTags)
      .values({ bookId: book.id, tagId })
      .onConflictDoNothing()
      .run();
  }

  // Handle cover image
  if (embedded.coverImage) {
    await saveCoverImage(book.id, embedded.coverImage);
  }

  // For audio files, create audio track record
  if (['m4b', 'mp3'].includes(format)) {
    db.insert(schema.audioTracks)
      .values({
        bookId: book.id,
        fileId: file.id,
        trackIndex: 0,
        title: title,
        durationSeconds: duration || 0,
        startOffsetSeconds: 0,
      })
      .run();

    // Store chapters
    if (embedded.chapters) {
      for (const chapter of embedded.chapters) {
        db.insert(schema.audioChapters)
          .values({
            bookId: book.id,
            title: chapter.title,
            startTime: chapter.startTime,
            endTime: chapter.endTime,
            trackIndex: 0,
          })
          .run();
      }
    }
  }

  return 'added';
}

interface EmbeddedMetadata {
  title: string | null;
  author: string | null;
  creators: { name: string; role: string }[] | null;
  description: string | null;
  language: string | null;
  publisher: string | null;
  date: string | null;
  isbn: string | null;
  subjects: string[];
  duration: number | null;
  coverImage: Buffer | null;
  chapters: { title: string; startTime: number; endTime: number }[] | null;
}

async function extractEmbeddedMetadata(filePath: string, format: string): Promise<EmbeddedMetadata> {
  const empty: EmbeddedMetadata = {
    title: null, author: null, creators: null, description: null,
    language: null, publisher: null, date: null, isbn: null,
    subjects: [], duration: null, coverImage: null, chapters: null,
  };

  try {
    if (format === 'epub') {
      const epub = await parseEpub(filePath);
      return {
        title: epub.title || null,
        author: epub.creators.length > 0 ? epub.creators[0]!.name : null,
        creators: epub.creators.length > 0 ? epub.creators : null,
        description: epub.description,
        language: epub.language,
        publisher: epub.publisher,
        date: epub.date,
        isbn: epub.isbn,
        subjects: epub.subjects,
        duration: null,
        coverImage: epub.coverImage,
        chapters: null,
      };
    }

    if (format === 'm4b' || format === 'mp3') {
      const audio = await parseAudioMetadata(filePath);
      return {
        title: audio.title || audio.album,
        author: audio.artist || audio.albumArtist,
        creators: null,
        description: null,
        language: null,
        publisher: null,
        date: audio.year ? String(audio.year) : null,
        isbn: null,
        subjects: [],
        duration: audio.duration,
        coverImage: audio.coverImage,
        chapters: audio.chapters.length > 0 ? audio.chapters : null,
      };
    }
  } catch (err) {
    console.error(`[Scanner] Metadata extraction error for ${filePath}:`, err);
  }

  return empty;
}

async function extractAndUpdateMetadata(filePath: string, format: string, bookId: number): Promise<void> {
  const embedded = await extractEmbeddedMetadata(filePath, format);
  if (!embedded.title && !embedded.author) return;

  const updates: Record<string, any> = { updatedAt: new Date().toISOString() };
  if (embedded.title) updates.title = embedded.title;
  if (embedded.description) updates.description = embedded.description;
  if (embedded.language) updates.language = embedded.language;
  if (embedded.publisher) updates.publisher = embedded.publisher;
  if (embedded.date) updates.publishDate = embedded.date;
  if (embedded.isbn) {
    if (embedded.isbn.length === 13) updates.isbn13 = embedded.isbn;
    else if (embedded.isbn.length === 10) updates.isbn10 = embedded.isbn;
  }
  if (embedded.duration) updates.audioSeconds = embedded.duration;

  db.update(schema.books).set(updates).where(eq(schema.books.id, bookId)).run();

  if (embedded.coverImage) {
    await saveCoverImage(bookId, embedded.coverImage);
  }
}

function findOrCreateAuthor(name: string): number {
  const existing = db.select().from(schema.authors).where(eq(schema.authors.name, name)).get();
  if (existing) return existing.id;
  return db.insert(schema.authors)
    .values({ name, sortName: toSortName(name) })
    .returning()
    .get().id;
}

function findOrCreateSeries(name: string): number {
  const existing = db.select().from(schema.series).where(eq(schema.series.name, name)).get();
  if (existing) return existing.id;
  return db.insert(schema.series).values({ name }).returning().get().id;
}

function findOrCreateTag(name: string, source: 'hardcover' | 'user'): number {
  const existing = db.select().from(schema.tags).where(eq(schema.tags.name, name)).get();
  if (existing) return existing.id;
  return db.insert(schema.tags).values({ name, source }).returning().get().id;
}

async function saveCoverImage(bookId: number, imageBuffer: Buffer): Promise<void> {
  try {
    const coverPath = await extractAndCacheCover(imageBuffer, bookId);
    if (coverPath) {
      db.update(schema.books)
        .set({ coverPath })
        .where(eq(schema.books.id, bookId))
        .run();
    }
  } catch (err) {
    console.error(`[Scanner] Cover save error for book ${bookId}:`, err);
  }
}

async function computeHash(filePath: string, format: string): Promise<string> {
  const isAudio = ['m4b', 'mp3'].includes(format);
  const stat = fs.statSync(filePath);

  if (isAudio && stat.size > AUDIO_PARTIAL_HASH_SIZE * 4) {
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

  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (data) => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}
