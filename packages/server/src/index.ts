import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { initializeDatabase, runMigrations, sqlite } from './db/index.js';
import { authRouter } from './routes/auth.js';
import { booksRouter } from './routes/books.js';
import { librariesRouter } from './routes/libraries.js';
import { audioRouter } from './routes/audio.js';
import { readerRouter } from './routes/reader.js';
import { metadataRouter } from './routes/metadata.js';
import { opdsRouter } from './routes/opds.js';
import { kindleRouter } from './routes/kindle.js';
import { collectionsRouter } from './routes/collections.js';
import { seriesRouter } from './routes/series.js';
import { settingsRouter } from './routes/settings.js';
import { searchRouter } from './routes/search.js';
import { jobsRouter } from './routes/jobs.js';
import { renameRouter } from './routes/rename.js';
import { authorsRouter } from './routes/authors.js';
import { authMiddleware } from './middleware/auth.js';
import { registerJobHandler, startJobProcessor, stopJobProcessor, recoverStaleJobs } from './services/job-queue.js';
import { scanLibrary } from './services/scanner.js';
import { enrichBook, enrichAllUnmatched } from './services/metadata-pipeline.js';
import { backfillCovers } from './services/cover-backfill.js';
import { mergeAudiobook, isFfmpegAvailable } from './services/audio-merge.js';
import { isCalibreAvailable } from './services/metadata-writer.js';
import { convertBook } from './services/format-converter.js';
import { initializeWatchers, stopAllWatchers } from './services/file-watcher.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = Number.parseInt(process.env.PORT || '3001', 10);

// Initialize database
initializeDatabase();
runMigrations();

// Recover any jobs left in 'processing' state from a previous crash/restart
recoverStaleJobs();

// Register job handlers
registerJobHandler('scan_library', async (payload) => {
  const libraryId = payload.libraryId as number;
  console.log(`[Jobs] Starting scan for library ${libraryId}`);
  const result = await scanLibrary(libraryId);
  console.log(`[Jobs] Scan complete: ${result.booksAdded} added, ${result.booksUpdated} updated, ${result.errors.length} errors`);
});

registerJobHandler('match_metadata', async (payload) => {
  const bookId = payload.bookId as number;
  console.log(`[Jobs] Starting metadata match for book ${bookId}`);
  await enrichBook(bookId);
});

registerJobHandler('match_all_metadata', async () => {
  console.log('[Jobs] Starting batch metadata match');
  const result = await enrichAllUnmatched();
  console.log(`[Jobs] Batch match complete: ${result.matched}/${result.total} matched`);
});

registerJobHandler('backfill_covers', async () => {
  console.log('[Jobs] Starting cover backfill');
  const result = await backfillCovers();
  console.log(`[Jobs] Cover backfill complete: ${result.processed} processed, ${result.errors} errors`);
});

registerJobHandler('merge_audiobook', async (payload) => {
  const bookId = payload.bookId as number;
  console.log(`[Jobs] Starting audiobook merge for book ${bookId}`);
  const outputPath = await mergeAudiobook(bookId);
  console.log(`[Jobs] Merge complete: ${outputPath}`);
});

registerJobHandler('convert_format', async (payload) => {
  const { fileId, targetFormat } = payload as { fileId: number; targetFormat: string };
  console.log(`[Jobs] Starting format conversion: file ${fileId} → ${targetFormat}`);
  const result = await convertBook(fileId, targetFormat);
  console.log(`[Jobs] Conversion complete: ${result.outputPath}`);
});

// Start background job processor
startJobProcessor();

// Backfill covers on startup (async, non-blocking)
backfillCovers().catch((err) => console.error('[Startup] Cover backfill error:', err));

// Start file watchers for all enabled libraries
initializeWatchers();

// Global middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());

// Health check (no auth)
app.get('/api/health', (_req, res) => {
  try {
    // Verify DB is responsive
    const dbCheck = sqlite.prepare('SELECT 1 as ok').get() as { ok: number } | undefined;
    if (dbCheck?.ok !== 1) {
      res.status(503).json({ status: 'error', error: 'Database check failed' });
      return;
    }

    // Book count
    const bookCount = (sqlite.prepare('SELECT COUNT(*) as count FROM books').get() as { count: number }).count;

    // Job queue summary
    const jobRows = sqlite.prepare('SELECT status, COUNT(*) as count FROM job_queue GROUP BY status').all() as { status: string; count: number }[];
    const jobs: Record<string, number> = { pending: 0, processing: 0, completed: 0, failed: 0 };
    for (const row of jobRows) jobs[row.status] = row.count;

    // Cover cache stats
    const coverDir = process.env.COVER_CACHE_PATH || './cache/covers';
    let coverCount = 0;
    try {
      if (fs.existsSync(coverDir)) {
        coverCount = fs.readdirSync(coverDir).filter((f: string) => f.endsWith('.webp')).length;
      }
    } catch { /* ignore */ }

    res.json({
      status: 'ok',
      version: '0.4.0',
      uptime: process.uptime(),
      database: 'connected',
      books: bookCount,
      jobs,
      covers: coverCount,
    });
  } catch (error) {
    console.error('[Health] Check failed:', error);
    res.status(503).json({ status: 'error', error: 'Health check failed' });
  }
});

// Public cover endpoint — <img> tags can't send Bearer tokens, so covers
// are served without auth. This must be registered BEFORE the protected books router.
app.get('/api/books/:id/cover/:size', (req, res) => {
  try {
    const bookId = Number.parseInt(req.params.id);
    if (Number.isNaN(bookId)) { res.status(400).json({ error: 'Invalid book ID' }); return; }
    const size = req.params.size;
    if (!['thumb', 'medium', 'full'].includes(size)) {
      res.status(400).json({ error: 'Invalid size' });
      return;
    }

    const book = sqlite.prepare('SELECT cover_path FROM books WHERE id = ?').get(bookId) as { cover_path: string | null } | undefined;
    if (!book?.cover_path) {
      res.status(404).json({ error: 'No cover available' });
      return;
    }

    const coverDir = process.env.COVER_CACHE_PATH || './cache/covers';
    const webpFile = path.join(coverDir, `${bookId}_${size}.webp`);

    res.setHeader('Cache-Control', 'public, max-age=86400');

    if (fs.existsSync(webpFile)) {
      res.setHeader('Content-Type', 'image/webp');
      res.sendFile(path.resolve(webpFile));
    } else {
      // Fallback to original binary
      const originalFile = path.join(coverDir, `${bookId}_original`);
      if (fs.existsSync(originalFile)) {
        res.sendFile(path.resolve(originalFile));
      } else {
        res.status(404).json({ error: 'Cover file not found' });
      }
    }
  } catch (error) {
    console.error('[Cover] Serve error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Public file download — window.open() can't send Bearer tokens
app.get('/api/books/:id/file', (req, res) => {
  try {
    const bookId = Number.parseInt(req.params.id);
    if (Number.isNaN(bookId)) { res.status(400).json({ error: 'Invalid book ID' }); return; }
    const formatPref = req.query.format as string | undefined;

    let file: any;
    if (formatPref) {
      file = sqlite.prepare('SELECT * FROM files WHERE book_id = ? AND format = ?').get(bookId, formatPref);
    }
    if (!file) {
      file = sqlite.prepare('SELECT * FROM files WHERE book_id = ? LIMIT 1').get(bookId);
    }
    if (!file) { res.status(404).json({ error: 'No file found' }); return; }

    if (!fs.existsSync(file.path)) {
      res.status(404).json({ error: 'File not found on disk' });
      return;
    }

    res.setHeader('Content-Type', file.mime_type);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.sendFile(path.resolve(file.path));
  } catch (error) {
    console.error('[Download] Serve error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Public audio stream — <audio> elements can't send Bearer tokens
app.get('/api/audiobooks/:id/stream/:trackIndex', (req, res) => {
  try {
    const bookId = Number.parseInt(req.params.id);
    const trackIndex = Number.parseInt(req.params.trackIndex);
    if (Number.isNaN(bookId) || Number.isNaN(trackIndex)) {
      res.status(400).json({ error: 'Invalid parameters' });
      return;
    }

    const track = sqlite.prepare(
      'SELECT * FROM audio_tracks WHERE book_id = ? AND track_index = ?',
    ).get(bookId, trackIndex) as any;
    if (!track) { res.status(404).json({ error: 'Track not found' }); return; }

    const file = sqlite.prepare('SELECT * FROM files WHERE id = ?').get(track.file_id) as any;
    if (!file || !fs.existsSync(file.path)) {
      res.status(404).json({ error: 'Audio file not found' });
      return;
    }

    const stat = fs.statSync(file.path);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = Number.parseInt(parts[0], 10);
      const end = parts[1] ? Number.parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': file.mime_type,
      });
      fs.createReadStream(file.path, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': file.mime_type,
        'Accept-Ranges': 'bytes',
      });
      fs.createReadStream(file.path).pipe(res);
    }
  } catch (error) {
    console.error('[Audio] Stream error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Public reader content — ReactReader/pdfjs can't send Bearer tokens
app.get('/api/reader/books/:id/content', (req, res) => {
  try {
    const bookId = Number.parseInt(req.params.id);
    if (Number.isNaN(bookId)) { res.status(400).json({ error: 'Invalid book ID' }); return; }
    const formatPref = (req.query.format as string) || 'epub';

    const file = sqlite.prepare(
      'SELECT * FROM files WHERE book_id = ? AND format = ?',
    ).get(bookId, formatPref) as any;

    if (!file || !fs.existsSync(file.path)) {
      res.status(404).json({ error: 'Book file not found' });
      return;
    }

    res.setHeader('Content-Security-Policy', "script-src 'none'; object-src 'none'");
    res.setHeader('Content-Type', file.mime_type);
    res.setHeader('Content-Disposition', `inline; filename="${file.filename}"`);
    res.sendFile(path.resolve(file.path));
  } catch (error) {
    console.error('[Reader] Content error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Auth routes (no auth middleware)
app.use('/api', authRouter);

// OPDS routes (uses own Basic auth)
app.use('/opds', opdsRouter);

// Protected API routes
app.use('/api/books', authMiddleware, booksRouter);
app.use('/api/libraries', authMiddleware, librariesRouter);
app.use('/api/audiobooks', authMiddleware, audioRouter);
app.use('/api/reader', authMiddleware, readerRouter);
app.use('/api/metadata', authMiddleware, metadataRouter);
app.use('/api/kindle', authMiddleware, kindleRouter);
app.use('/api/collections', authMiddleware, collectionsRouter);
app.use('/api/series', authMiddleware, seriesRouter);
app.use('/api/settings', authMiddleware, settingsRouter);
app.use('/api/search', authMiddleware, searchRouter);
app.use('/api/jobs', authMiddleware, jobsRouter);
app.use('/api/books', authMiddleware, renameRouter);
app.use('/api/authors', authMiddleware, authorsRouter);

// Serve static frontend in production
const clientDist = path.join(__dirname, '../../client/dist');
app.use(express.static(clientDist));
app.get('*', (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Server] NPC-Shelf running on http://0.0.0.0:${PORT}`);
  if (!isFfmpegAvailable()) {
    console.warn('[Server] ffmpeg not found — audiobook merge will be unavailable');
  }
  if (!isCalibreAvailable()) {
    console.warn('[Server] Calibre (ebook-meta) not found — AZW3/MOBI metadata writing will be unavailable');
  }
});

// Graceful shutdown
async function shutdown(signal: string) {
  console.log(`[Server] ${signal} received, shutting down gracefully...`);
  stopAllWatchers();
  await stopJobProcessor();
  server.close(() => {
    sqlite.close();
    console.log('[Server] Shut down complete');
    process.exit(0);
  });
  // Force exit after 10s
  setTimeout(() => process.exit(1), 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default app;
