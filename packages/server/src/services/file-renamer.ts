import { eq, sql } from 'drizzle-orm';
import { db, schema, sqlite } from '../db/index.js';
import sanitize from 'sanitize-filename';
import fs from 'node:fs';
import path from 'node:path';

interface RenamePreview {
  fileId: number;
  currentPath: string;
  newPath: string;
  status: 'rename' | 'unchanged' | 'conflict';
}

interface RenameResult {
  fileId: number;
  success: boolean;
  oldPath: string;
  newPath: string;
  error?: string;
}

// Audiobookshelf-style templates
const TEMPLATE_WITH_SERIES = '{author}/{series}/Book {series_index} - {title}/{title}.{ext}';
const TEMPLATE_NO_SERIES = '{author}/{title}/{title}.{ext}';

function getBookData(bookId: number) {
  const book = db.select().from(schema.books).where(eq(schema.books.id, bookId)).get();
  if (!book) return null;

  const authorRows = db
    .select({ name: schema.authors.name })
    .from(schema.bookAuthors)
    .innerJoin(schema.authors, eq(schema.bookAuthors.authorId, schema.authors.id))
    .where(sql`${schema.bookAuthors.bookId} = ${bookId} AND ${schema.bookAuthors.role} = 'author'`)
    .all();

  const seriesRow = db
    .select({ name: schema.series.name, position: schema.bookSeries.position })
    .from(schema.bookSeries)
    .innerJoin(schema.series, eq(schema.bookSeries.seriesId, schema.series.id))
    .where(eq(schema.bookSeries.bookId, bookId))
    .limit(1)
    .get();

  return {
    title: book.title,
    author: authorRows[0]?.name || 'Unknown Author',
    series: seriesRow?.name || null,
    seriesPosition: seriesRow?.position || null,
    publishDate: book.publishDate,
    isbn13: book.isbn13,
  };
}

function sanitizeSegment(s: string): string {
  const cleaned = sanitize(s)
    .replace(/^[\s-]+/, '')
    .replace(/[\s-]+$/, '')
    .replaceAll(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, 200) || 'Unknown';
}

function buildPath(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(`{${key}}`, value);
  }
  return result;
}

function resolveTemplate(
  file: { format: string; filename: string },
  bookData: ReturnType<typeof getBookData>,
): string {
  if (!bookData) return file.filename;

  const ext = file.format;
  const hasSeries = !!(bookData.series && bookData.seriesPosition);
  const template = hasSeries ? TEMPLATE_WITH_SERIES : TEMPLATE_NO_SERIES;

  const vars: Record<string, string> = {
    author: sanitizeSegment(bookData.author),
    title: sanitizeSegment(bookData.title),
    series: bookData.series ? sanitizeSegment(bookData.series) : '',
    series_index: bookData.seriesPosition ? String(bookData.seriesPosition).padStart(2, '0') : '',
    year: bookData.publishDate?.slice(0, 4) || '',
    isbn: bookData.isbn13 || '',
    ext,
  };

  return buildPath(template, vars);
}

/**
 * Preview renames for a book. Returns diffs without modifying disk.
 */
export function previewRename(bookId: number): RenamePreview[] {
  const bookData = getBookData(bookId);
  if (!bookData) return [];

  const files = db.select().from(schema.files).where(eq(schema.files.bookId, bookId)).all();
  const library = files[0]
    ? db.select().from(schema.libraries).where(eq(schema.libraries.id, files[0].libraryId)).get()
    : null;

  if (!library) return [];

  const results: RenamePreview[] = [];
  const seenPaths = new Set<string>();

  for (const file of files) {
    const relativePath = resolveTemplate(
      { format: file.format, filename: file.filename },
      bookData,
    );
    const newPath = path.join(library.path, relativePath);

    // Safety: ensure new path stays within library root
    const resolvedNew = path.resolve(newPath);
    const resolvedLib = path.resolve(library.path);
    if (!resolvedNew.startsWith(resolvedLib + path.sep) && resolvedNew !== resolvedLib) {
      results.push({ fileId: file.id, currentPath: file.path, newPath: resolvedNew, status: 'conflict' });
      continue;
    }

    if (file.path === newPath) {
      results.push({ fileId: file.id, currentPath: file.path, newPath, status: 'unchanged' });
    } else if (seenPaths.has(newPath) || (fs.existsSync(newPath) && newPath !== file.path)) {
      results.push({ fileId: file.id, currentPath: file.path, newPath, status: 'conflict' });
    } else {
      results.push({ fileId: file.id, currentPath: file.path, newPath, status: 'rename' });
    }
    seenPaths.add(newPath);
  }

  return results;
}

/**
 * Execute renames for a book. Updates disk and database atomically.
 */
export function executeRename(bookId: number): RenameResult[] {
  const previews = previewRename(bookId);
  const toRename = previews.filter(p => p.status === 'rename');

  if (toRename.length === 0) return [];

  const results: RenameResult[] = [];
  const renamedPaths: { fileId: number; oldPath: string; newPath: string }[] = [];

  // Phase 1: Move files on disk
  for (const preview of toRename) {
    try {
      // Verify source exists
      if (!fs.existsSync(preview.currentPath)) {
        results.push({ fileId: preview.fileId, success: false, oldPath: preview.currentPath, newPath: preview.newPath, error: 'Source file not found' });
        continue;
      }

      // Create target directory
      fs.mkdirSync(path.dirname(preview.newPath), { recursive: true });

      // Move file
      fs.renameSync(preview.currentPath, preview.newPath);
      renamedPaths.push({ fileId: preview.fileId, oldPath: preview.currentPath, newPath: preview.newPath });
      results.push({ fileId: preview.fileId, success: true, oldPath: preview.currentPath, newPath: preview.newPath });
    } catch (err: any) {
      results.push({ fileId: preview.fileId, success: false, oldPath: preview.currentPath, newPath: preview.newPath, error: err.message });
    }
  }

  // Phase 2: Update database atomically
  if (renamedPaths.length > 0) {
    try {
      const updateDb = sqlite.transaction(() => {
        for (const { fileId, newPath } of renamedPaths) {
          db.update(schema.files)
            .set({ path: newPath, filename: path.basename(newPath) })
            .where(eq(schema.files.id, fileId))
            .run();
        }
      });
      updateDb();
    } catch (err: any) {
      // DB failed — try to move files back
      for (const { oldPath, newPath } of renamedPaths) {
        try { fs.renameSync(newPath, oldPath); } catch { /* ignore */ }
      }
      return renamedPaths.map(r => ({ ...r, success: false, error: `DB update failed: ${err.message}` }));
    }
  }

  // Phase 3: Clean up empty directories
  for (const { oldPath } of renamedPaths) {
    cleanEmptyDirs(path.dirname(oldPath));
  }

  return results;
}

function cleanEmptyDirs(dirPath: string) {
  try {
    const entries = fs.readdirSync(dirPath);
    if (entries.length === 0) {
      fs.rmdirSync(dirPath);
      cleanEmptyDirs(path.dirname(dirPath));
    }
  } catch { /* ignore */ }
}
