import { eq, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import JSZip from 'jszip';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import NodeID3 from 'node-id3';
import { PDFDocument } from 'pdf-lib';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

interface WriteResult {
  fileId: number;
  success: boolean;
  fieldsWritten: string[];
  error?: string;
}

interface BookMeta {
  title: string;
  authors: string[];
  description: string | null;
  publisher: string | null;
  publishDate: string | null;
  isbn13: string | null;
  series: string | null;
  seriesPosition: number | null;
  language: string | null;
}

function getBookMeta(bookId: number): BookMeta | null {
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
    authors: authorRows.map(a => a.name),
    description: book.description,
    publisher: book.publisher,
    publishDate: book.publishDate,
    isbn13: book.isbn13,
    series: seriesRow?.name ?? null,
    seriesPosition: seriesRow?.position ?? null,
    language: book.language,
  };
}

/**
 * Write metadata into a file based on its format.
 */
export async function writeFileMetadata(fileId: number): Promise<WriteResult> {
  const file = db.select().from(schema.files).where(eq(schema.files.id, fileId)).get();
  if (!file) return { fileId, success: false, fieldsWritten: [], error: 'File not found' };
  if (!fs.existsSync(file.path)) return { fileId, success: false, fieldsWritten: [], error: 'File not found on disk' };

  const meta = getBookMeta(file.bookId);
  if (!meta) return { fileId, success: false, fieldsWritten: [], error: 'Book not found' };

  try {
    switch (file.format) {
      case 'epub':
        return await writeEpubMetadata(fileId, file.path, meta);
      case 'mp3':
        return writeMp3Metadata(fileId, file.path, meta);
      case 'm4b':
        return writeM4bMetadata(fileId, file.path, meta);
      case 'pdf':
        return await writePdfMetadata(fileId, file.path, meta);
      case 'azw3':
      case 'mobi':
        return writeCalibreMetadata(fileId, file.path, meta);
      default:
        return { fileId, success: false, fieldsWritten: [], error: `Unsupported format: ${file.format}` };
    }
  } catch (err: any) {
    return { fileId, success: false, fieldsWritten: [], error: err.message };
  }
}

/**
 * Write metadata to all files for a book.
 */
export async function writeBookMetadata(bookId: number): Promise<WriteResult[]> {
  const files = db.select().from(schema.files).where(eq(schema.files.bookId, bookId)).all();
  const results: WriteResult[] = [];
  for (const file of files) {
    results.push(await writeFileMetadata(file.id));
  }
  return results;
}

// ===== EPUB =====

async function writeEpubMetadata(fileId: number, filePath: string, meta: BookMeta): Promise<WriteResult> {
  const data = fs.readFileSync(filePath);
  const zip = await JSZip.loadAsync(data);

  // Find OPF file via container.xml
  const containerXml = await zip.file('META-INF/container.xml')?.async('string');
  if (!containerXml) return { fileId, success: false, fieldsWritten: [], error: 'No container.xml' };

  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  const container = parser.parse(containerXml);
  const rootfiles = container?.container?.rootfiles?.rootfile;
  const opfPath = Array.isArray(rootfiles) ? rootfiles[0]?.['@_full-path'] : rootfiles?.['@_full-path'];
  if (!opfPath) return { fileId, success: false, fieldsWritten: [], error: 'No OPF path found' };

  const opfContent = await zip.file(opfPath)?.async('string');
  if (!opfContent) return { fileId, success: false, fieldsWritten: [], error: 'OPF file not found' };

  const opf = parser.parse(opfContent);
  const metadata = opf?.package?.metadata || {};
  const fieldsWritten: string[] = [];

  // Update Dublin Core fields
  if (meta.title) { metadata['dc:title'] = meta.title; fieldsWritten.push('title'); }
  if (meta.authors.length > 0) { metadata['dc:creator'] = meta.authors.join(', '); fieldsWritten.push('creator'); }
  if (meta.description) { metadata['dc:description'] = meta.description; fieldsWritten.push('description'); }
  if (meta.publishDate) { metadata['dc:date'] = meta.publishDate; fieldsWritten.push('date'); }
  if (meta.publisher) { metadata['dc:publisher'] = meta.publisher; fieldsWritten.push('publisher'); }
  if (meta.isbn13) { metadata['dc:identifier'] = meta.isbn13; fieldsWritten.push('identifier'); }
  if (meta.language) { metadata['dc:language'] = meta.language; fieldsWritten.push('language'); }

  // Add Calibre series metadata
  if (meta.series) {
    // Ensure meta array exists for calibre extensions
    if (!Array.isArray(metadata.meta)) {
      metadata.meta = metadata.meta ? [metadata.meta] : [];
    }
    // Remove existing calibre series/index entries
    metadata.meta = metadata.meta.filter((m: any) =>
      m?.['@_name'] !== 'calibre:series' && m?.['@_name'] !== 'calibre:series_index',
    );
    metadata.meta.push({ '@_name': 'calibre:series', '@_content': meta.series });
    if (meta.seriesPosition != null) {
      metadata.meta.push({ '@_name': 'calibre:series_index', '@_content': String(meta.seriesPosition) });
    }
    fieldsWritten.push('series');
  }

  opf.package.metadata = metadata;

  const builder = new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: '@_', format: true });
  const newOpf = builder.build(opf);
  zip.file(opfPath, newOpf);

  const output = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  fs.writeFileSync(filePath, output);

  return { fileId, success: true, fieldsWritten };
}

// ===== MP3 =====

function writeMp3Metadata(fileId: number, filePath: string, meta: BookMeta): WriteResult {
  const tags: NodeID3.Tags = {};
  const fieldsWritten: string[] = [];

  if (meta.title) { tags.title = meta.title; fieldsWritten.push('title'); }
  if (meta.authors.length > 0) { tags.artist = meta.authors.join(', '); fieldsWritten.push('artist'); }
  if (meta.series) { tags.album = meta.series; fieldsWritten.push('album'); }
  if (meta.publishDate) { tags.year = meta.publishDate.slice(0, 4); fieldsWritten.push('year'); }
  tags.genre = 'Audiobook';
  fieldsWritten.push('genre');

  if (meta.series && meta.seriesPosition != null) {
    tags.trackNumber = String(meta.seriesPosition);
    fieldsWritten.push('trackNumber');
  }

  const result = NodeID3.update(tags, filePath);
  if (result !== true) {
    return { fileId, success: false, fieldsWritten: [], error: 'Failed to write ID3 tags' };
  }

  return { fileId, success: true, fieldsWritten };
}

// ===== M4B/M4A (via ffmpeg) =====

function writeM4bMetadata(fileId: number, filePath: string, meta: BookMeta): WriteResult {
  if (!isFfmpegAvailable()) {
    return { fileId, success: false, fieldsWritten: [], error: 'ffmpeg not available' };
  }

  const fieldsWritten: string[] = [];
  const metadataArgs: string[] = [];

  if (meta.title) { metadataArgs.push('-metadata', `title=${meta.title}`); fieldsWritten.push('title'); }
  if (meta.authors.length > 0) {
    const author = meta.authors.join(', ');
    metadataArgs.push('-metadata', `artist=${author}`);
    metadataArgs.push('-metadata', `album_artist=${author}`);
    fieldsWritten.push('artist');
  }
  if (meta.series) { metadataArgs.push('-metadata', `album=${meta.series}`); fieldsWritten.push('album'); }
  if (meta.publishDate) { metadataArgs.push('-metadata', `date=${meta.publishDate.slice(0, 4)}`); fieldsWritten.push('date'); }
  metadataArgs.push('-metadata', 'genre=Audiobook');
  fieldsWritten.push('genre');

  if (meta.series && meta.seriesPosition != null) {
    metadataArgs.push('-metadata', `comment=Series: ${meta.series} #${meta.seriesPosition}`);
    fieldsWritten.push('comment');
  }

  const tmpPath = filePath + '.tmp';
  try {
    execFileSync('ffmpeg', ['-i', filePath, ...metadataArgs, '-c', 'copy', '-y', tmpPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120000,
    });
    fs.renameSync(tmpPath, filePath);
  } catch (err: any) {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    return { fileId, success: false, fieldsWritten: [], error: `ffmpeg error: ${err.message}` };
  }

  return { fileId, success: true, fieldsWritten };
}

function isFfmpegAvailable(): boolean {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// ===== PDF =====

async function writePdfMetadata(fileId: number, filePath: string, meta: BookMeta): Promise<WriteResult> {
  const data = fs.readFileSync(filePath);
  const pdfDoc = await PDFDocument.load(data, { updateMetadata: false });
  const fieldsWritten: string[] = [];

  if (meta.title) { pdfDoc.setTitle(meta.title); fieldsWritten.push('title'); }
  if (meta.authors.length > 0) { pdfDoc.setAuthor(meta.authors.join(', ')); fieldsWritten.push('author'); }
  if (meta.description) { pdfDoc.setSubject(meta.description.slice(0, 500)); fieldsWritten.push('subject'); }
  if (meta.series) { pdfDoc.setKeywords([meta.series]); fieldsWritten.push('keywords'); }

  const output = await pdfDoc.save();
  fs.writeFileSync(filePath, output);

  return { fileId, success: true, fieldsWritten };
}

// ===== AZW3/MOBI (via Calibre ebook-meta) =====

function isCalibreAvailable(): boolean {
  try {
    execFileSync('ebook-meta', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function writeCalibreMetadata(fileId: number, filePath: string, meta: BookMeta): WriteResult {
  if (!isCalibreAvailable()) {
    return { fileId, success: false, fieldsWritten: [], error: 'Calibre (ebook-meta) not available' };
  }

  const args: string[] = [filePath];
  const fieldsWritten: string[] = [];

  if (meta.title) { args.push('-t', meta.title); fieldsWritten.push('title'); }
  if (meta.authors.length > 0) { args.push('-a', meta.authors.join(' & ')); fieldsWritten.push('author'); }
  if (meta.publisher) { args.push('-p', meta.publisher); fieldsWritten.push('publisher'); }
  if (meta.publishDate) { args.push('-d', meta.publishDate); fieldsWritten.push('date'); }
  if (meta.isbn13) { args.push('--isbn', meta.isbn13); fieldsWritten.push('isbn'); }
  if (meta.series) { args.push('--series', meta.series); fieldsWritten.push('series'); }
  if (meta.seriesPosition != null) { args.push('--index', String(meta.seriesPosition)); fieldsWritten.push('series_index'); }

  try {
    execFileSync('ebook-meta', args, { stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 });
  } catch (err: any) {
    return { fileId, success: false, fieldsWritten: [], error: `ebook-meta error: ${err.message}` };
  }

  return { fileId, success: true, fieldsWritten };
}

export { isCalibreAvailable };
