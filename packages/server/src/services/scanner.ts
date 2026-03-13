import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { SUPPORTED_AUDIO_FORMATS, MIME_TYPES } from '@npc-shelf/shared';
import { toSortName } from '../utils/filename-parser.js';
import { parseEpub } from './epub-parser.js';
import { parseAudioMetadata } from './audio-parser.js';
import { extractAndCacheCover } from './cover.js';
import { runPipeline, discoverFiles, type BookCandidate, type FileCandidate } from './scan-pipeline.js';
import type { ScanStatus } from '@npc-shelf/shared';

const AUDIO_PARTIAL_HASH_SIZE = 64 * 1024; // 64KB
const AUDIO_EXTENSIONS = new Set(SUPPORTED_AUDIO_FORMATS as readonly string[]);

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
    // Pass 0: Detect removed files
    const diskFiles = discoverFiles(library.path);
    const diskPathSet = new Set(diskFiles.map((f) => f.path));

    const indexedFiles = db
      .select({ id: schema.files.id, path: schema.files.path, bookId: schema.files.bookId })
      .from(schema.files)
      .where(eq(schema.files.libraryId, libraryId))
      .all();

    for (const removed of indexedFiles.filter((f) => !diskPathSet.has(f.path))) {
      db.delete(schema.files).where(eq(schema.files.id, removed.id)).run();
      const remainingFiles = db
        .select({ id: schema.files.id })
        .from(schema.files)
        .where(eq(schema.files.bookId, removed.bookId))
        .all();
      if (remainingFiles.length === 0) {
        // Clean up audio tracks and chapters before deleting book
        db.delete(schema.audioTracks).where(eq(schema.audioTracks.bookId, removed.bookId)).run();
        db.delete(schema.audioChapters).where(eq(schema.audioChapters.bookId, removed.bookId)).run();
        db.delete(schema.books).where(eq(schema.books.id, removed.bookId)).run();
      }
    }

    // Run the multi-pass pipeline
    const candidates = runPipeline(library.path);
    status.filesFound = diskFiles.length;
    activeScanStatuses.set(libraryId, { ...status });

    // Process each BookCandidate
    for (const candidate of candidates) {
      try {
        const result = await persistCandidate(candidate, libraryId, status);
        if (result === 'added') status.booksAdded++;
        else if (result === 'updated') status.booksUpdated++;
        status.filesProcessed += candidate.files.length;
      } catch (err: any) {
        status.errors.push(`${candidate.resolvedTitle}: ${err.message}`);
        status.filesProcessed += candidate.files.length;
      }
      activeScanStatuses.set(libraryId, { ...status });
    }

    // Update last scanned time
    db.update(schema.libraries)
      .set({ lastScannedAt: new Date().toISOString() })
      .where(eq(schema.libraries.id, libraryId))
      .run();

    // Auto-queue metadata matching if setting is enabled and new books were added
    if (status.booksAdded > 0) {
      try {
        const autoMatch = db.select().from(schema.settings)
          .where(eq(schema.settings.key, 'metadataAutoMatch')).get();
        if (autoMatch?.value === 'true') {
          db.insert(schema.jobQueue).values({
            jobType: 'match_all_metadata',
            payload: '{}',
          }).run();
          console.log(`[Scanner] Auto-queued metadata match for ${status.booksAdded} new books`);
        }
      } catch (e) {
        console.error('[Scanner] Failed to queue auto-match:', e);
      }
    }

    status.status = 'complete';
    status.completedAt = new Date().toISOString();
  } catch (err: any) {
    status.status = 'error';
    status.errors.push(err.message);
  }

  activeScanStatuses.set(libraryId, { ...status });
  setTimeout(() => activeScanStatuses.delete(libraryId), 30000);

  return status;
}

type PersistResult = 'added' | 'updated' | 'skipped';

async function persistCandidate(
  candidate: BookCandidate,
  libraryId: number,
  _status: ScanStatus,
): Promise<PersistResult> {
  // Check if any file in the candidate already exists in DB
  let existingBookId: number | null = null;
  let allSkipped = true;

  for (const file of candidate.files) {
    const existing = db
      .select({ id: schema.files.id, bookId: schema.files.bookId, lastModified: schema.files.lastModified, sizeBytes: schema.files.sizeBytes })
      .from(schema.files)
      .where(eq(schema.files.path, file.path))
      .get();

    if (existing) {
      existingBookId = existing.bookId;
      // Check if modified
      if (existing.lastModified !== file.modifiedTime || existing.sizeBytes !== file.size) {
        allSkipped = false;
      }
    } else {
      allSkipped = false;
    }
  }

  if (existingBookId && allSkipped) {
    return 'skipped';
  }

  // Extract embedded metadata from the first (or only) file
  const primaryFile = candidate.files[0]!;
  const embedded = await extractEmbeddedMetadata(primaryFile.path, primaryFile.extension);

  // Merge embedded metadata with pipeline-resolved metadata
  // Embedded takes priority for title/author if higher quality than filename/directory
  const title = embedded.title || candidate.resolvedTitle;
  const authorName = embedded.author || candidate.resolvedAuthor;
  const description = embedded.description || null;
  const language = embedded.language || null;
  const publisher = embedded.publisher || null;
  const publishDate = embedded.date || null;
  const isbn = embedded.isbn || null;
  const subjects = embedded.subjects || [];

  // Calculate total duration for audiobooks — check actual file content, not just candidate flag
  const hasAudioFiles = candidate.files.some(f => f.isAudio);
  let totalDuration: number | null = null;
  if (hasAudioFiles) {
    const audioFileCount = candidate.files.filter(f => f.isAudio).length;
    if (audioFileCount === 1) {
      totalDuration = embedded.duration || null;
    } else {
      // For multi-file audiobooks, we'll compute duration per-track below
      totalDuration = 0;
    }
  }

  if (existingBookId) {
    // Update existing book
    db.update(schema.books)
      .set({
        title,
        description: description || undefined,
        language: language || undefined,
        publisher: publisher || undefined,
        publishDate: publishDate || undefined,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.books.id, existingBookId))
      .run();

    // Update/add files
    await syncFiles(candidate, existingBookId, libraryId);

    // Handle audiobook tracks
    if (hasAudioFiles) {
      await syncAudioTracks(candidate, existingBookId);
    }

    // Handle cover
    await handleCover(candidate, existingBookId, embedded);

    return 'updated';
  }

  // --- Create new book ---
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
      audioSeconds: totalDuration,
    })
    .returning()
    .get();

  // Create file records
  const fileRecords: { fileId: number; file: FileCandidate }[] = [];
  for (const file of candidate.files) {
    const hash = await computeHash(file.path, file.extension);
    const format = file.extension as 'epub' | 'pdf' | 'mobi' | 'azw3' | 'm4b' | 'mp3';
    const mimeType = MIME_TYPES[format] || 'application/octet-stream';

    const fileRecord = db
      .insert(schema.files)
      .values({
        bookId: book.id,
        libraryId,
        path: file.path,
        filename: file.filename,
        format,
        mimeType,
        sizeBytes: file.size,
        hashSha256: hash,
        lastModified: file.modifiedTime,
      })
      .returning()
      .get();

    fileRecords.push({ fileId: fileRecord.id, file });
  }

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
      if (creator.name === authorName) continue;
      const creatorId = findOrCreateAuthor(creator.name);
      db.insert(schema.bookAuthors)
        .values({ bookId: book.id, authorId: creatorId, role: creator.role as 'author' | 'narrator' | 'editor' })
        .onConflictDoNothing()
        .run();
    }
  }

  // Narrator from sidecar
  if (candidate.sidecarMeta?.narrator) {
    const narratorId = findOrCreateAuthor(candidate.sidecarMeta.narrator);
    db.insert(schema.bookAuthors)
      .values({ bookId: book.id, authorId: narratorId, role: 'narrator' })
      .onConflictDoNothing()
      .run();
  }

  // Series — support multiple
  const seriesList = candidate.resolvedSeriesList.length > 0
    ? candidate.resolvedSeriesList
    : candidate.resolvedSeries
      ? [{ name: candidate.resolvedSeries, position: candidate.resolvedSeriesPosition }]
      : [];

  for (const s of seriesList) {
    const seriesId = findOrCreateSeries(s.name);
    db.insert(schema.bookSeries)
      .values({ bookId: book.id, seriesId, position: s.position })
      .onConflictDoNothing()
      .run();
  }

  // Tags from embedded metadata + sidecar
  const allTags = [...subjects, ...(candidate.sidecarMeta?.tags || [])];
  const uniqueTags = [...new Set(allTags)];
  for (const tagName of uniqueTags) {
    const tagId = findOrCreateTag(tagName, 'user');
    db.insert(schema.bookTags)
      .values({ bookId: book.id, tagId })
      .onConflictDoNothing()
      .run();
  }

  // Audio tracks — only process audio files in the candidate
  if (hasAudioFiles) {
    const audioRecords = fileRecords.filter(r => r.file.isAudio);
    let cumulativeOffset = 0;
    for (let i = 0; i < audioRecords.length; i++) {
      const rec = audioRecords[i]!;
      let trackDuration = 0;

      if (i === 0 && embedded.duration) {
        trackDuration = embedded.duration;
      } else {
        try {
          const trackMeta = await parseAudioMetadata(rec.file.path);
          trackDuration = trackMeta.duration;
        } catch {
          // fallback: 0
        }
      }

      db.insert(schema.audioTracks)
        .values({
          bookId: book.id,
          fileId: rec.fileId,
          trackIndex: i,
          title: audioRecords.length === 1 ? title : `Track ${i + 1}`,
          durationSeconds: trackDuration,
          startOffsetSeconds: cumulativeOffset,
        })
        .run();

      cumulativeOffset += trackDuration;
    }

    // Update total duration
    if (cumulativeOffset > 0) {
      db.update(schema.books)
        .set({ audioSeconds: cumulativeOffset })
        .where(eq(schema.books.id, book.id))
        .run();
    }

    // Store chapters from first audio file
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

  // Handle cover
  await handleCover(candidate, book.id, embedded);

  return 'added';
}

async function syncFiles(candidate: BookCandidate, bookId: number, libraryId: number): Promise<void> {
  for (const file of candidate.files) {
    const existing = db.select().from(schema.files).where(eq(schema.files.path, file.path)).get();
    const format = file.extension as 'epub' | 'pdf' | 'mobi' | 'azw3' | 'm4b' | 'mp3';
    const mimeType = MIME_TYPES[format] || 'application/octet-stream';

    if (existing) {
      if (existing.lastModified !== file.modifiedTime || existing.sizeBytes !== file.size) {
        const hash = await computeHash(file.path, file.extension);
        db.update(schema.files)
          .set({ hashSha256: hash, lastModified: file.modifiedTime, sizeBytes: file.size })
          .where(eq(schema.files.id, existing.id))
          .run();
      }
    } else {
      const hash = await computeHash(file.path, file.extension);
      db.insert(schema.files)
        .values({
          bookId,
          libraryId,
          path: file.path,
          filename: file.filename,
          format,
          mimeType,
          sizeBytes: file.size,
          hashSha256: hash,
          lastModified: file.modifiedTime,
        })
        .run();
    }
  }
}

async function syncAudioTracks(candidate: BookCandidate, bookId: number): Promise<void> {
  // Delete existing tracks and rebuild
  db.delete(schema.audioTracks).where(eq(schema.audioTracks.bookId, bookId)).run();

  let cumulativeOffset = 0;
  for (let i = 0; i < candidate.files.length; i++) {
    const file = candidate.files[i]!;
    if (!file.isAudio) continue;

    const fileRecord = db.select().from(schema.files).where(eq(schema.files.path, file.path)).get();
    if (!fileRecord) continue;

    let trackDuration = 0;
    try {
      const meta = await parseAudioMetadata(file.path);
      trackDuration = meta.duration;
    } catch {
      // fallback
    }

    db.insert(schema.audioTracks)
      .values({
        bookId,
        fileId: fileRecord.id,
        trackIndex: i,
        title: candidate.files.length === 1 ? candidate.resolvedTitle : `Track ${i + 1}`,
        durationSeconds: trackDuration,
        startOffsetSeconds: cumulativeOffset,
      })
      .run();

    cumulativeOffset += trackDuration;
  }

  if (cumulativeOffset > 0) {
    db.update(schema.books)
      .set({ audioSeconds: cumulativeOffset })
      .where(eq(schema.books.id, bookId))
      .run();
  }
}

async function handleCover(candidate: BookCandidate, bookId: number, embedded: EmbeddedMetadata): Promise<void> {
  // Check if book already has a cover
  const book = db.select({ coverPath: schema.books.coverPath }).from(schema.books).where(eq(schema.books.id, bookId)).get();
  if (book?.coverPath) return; // Already has cover

  // Priority: sidecar cover > embedded cover
  if (candidate.sidecarMeta?.coverPath) {
    try {
      const coverBuffer = fs.readFileSync(candidate.sidecarMeta.coverPath);
      await saveCoverImage(bookId, coverBuffer);
      return;
    } catch {
      // Fall through to embedded
    }
  }

  if (embedded.coverImage) {
    await saveCoverImage(bookId, embedded.coverImage);
  }
}

// --- Shared helpers (kept from original) ---

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

export function findOrCreateAuthor(name: string): number {
  const existing = db.select().from(schema.authors).where(eq(schema.authors.name, name)).get();
  if (existing) return existing.id;
  return db.insert(schema.authors)
    .values({ name, sortName: toSortName(name) })
    .returning()
    .get().id;
}

export function findOrCreateSeries(name: string): number {
  const existing = db.select().from(schema.series).where(eq(schema.series.name, name)).get();
  if (existing) return existing.id;
  return db.insert(schema.series).values({ name }).returning().get().id;
}

export function findOrCreateTag(name: string, source: 'hardcover' | 'user'): number {
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
  const isAudio = AUDIO_EXTENSIONS.has(format);
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
