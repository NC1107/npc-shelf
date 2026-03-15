import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { isCalibreAvailable } from './metadata-writer.js';

const SUPPORTED_CONVERSIONS: Record<string, string[]> = {
  epub: ['mobi', 'azw3', 'pdf'],
  mobi: ['epub'],
  azw3: ['epub'],
  pdf: ['epub'],
};

/**
 * Convert a book file to a different format using Calibre's ebook-convert.
 * Returns the new file record ID.
 */
export async function convertBook(fileId: number, targetFormat: string): Promise<{ newFileId: number; outputPath: string }> {
  if (!isCalibreAvailable()) {
    throw new Error('Calibre (ebook-convert) is not available');
  }

  const file = db.select().from(schema.files).where(eq(schema.files.id, fileId)).get();
  if (!file) throw new Error('Source file not found');
  if (!fs.existsSync(file.path)) throw new Error('Source file not found on disk');

  const allowed = SUPPORTED_CONVERSIONS[file.format];
  if (!allowed?.includes(targetFormat)) {
    throw new Error(`Conversion from ${file.format} to ${targetFormat} is not supported`);
  }

  // Build output path next to the source file
  const dir = path.dirname(file.path);
  const baseName = path.basename(file.filename, path.extname(file.filename));
  const outputFilename = `${baseName}.${targetFormat}`;
  const outputPath = path.join(dir, outputFilename);

  if (fs.existsSync(outputPath)) {
    throw new Error(`Output file already exists: ${outputFilename}`);
  }

  // Run ebook-convert
  try {
    execFileSync('ebook-convert', [file.path, outputPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 300000, // 5 min
    });
  } catch (err: any) {
    // Clean up partial output
    try { fs.unlinkSync(outputPath); } catch { /* ignore */ }
    throw new Error(`ebook-convert failed: ${err.message}`, { cause: err });
  }

  if (!fs.existsSync(outputPath)) {
    throw new Error('Conversion completed but output file not found');
  }

  // Determine MIME type
  const mimeTypes: Record<string, string> = {
    epub: 'application/epub+zip',
    mobi: 'application/x-mobipocket-ebook',
    azw3: 'application/x-mobi8-ebook',
    pdf: 'application/pdf',
  };

  const stat = fs.statSync(outputPath);

  // Insert new file record
  const newFile = db.insert(schema.files).values({
    bookId: file.bookId,
    libraryId: file.libraryId,
    path: outputPath,
    filename: outputFilename,
    format: targetFormat as any,
    mimeType: mimeTypes[targetFormat] || 'application/octet-stream',
    sizeBytes: stat.size,
    hashSha256: '',
    lastModified: stat.mtime.toISOString(),
  }).returning().get();

  console.log(`[Convert] ${file.filename} → ${outputFilename} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);

  return { newFileId: newFile.id, outputPath };
}

export function isConvertAvailable(): boolean {
  return isCalibreAvailable();
}

export { SUPPORTED_CONVERSIONS };
