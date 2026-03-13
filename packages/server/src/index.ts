import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { initializeDatabase } from './db/index.js';
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
import { authMiddleware } from './middleware/auth.js';
import { registerJobHandler, startJobProcessor } from './services/job-queue.js';
import { scanLibrary } from './services/scanner.js';
import { enrichBook, enrichAllUnmatched } from './services/metadata-pipeline.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

// Initialize database
initializeDatabase();

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

// Start background job processor
startJobProcessor();

// Global middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());

// Health check (no auth)
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    version: '0.1.0',
    uptime: process.uptime(),
  });
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

// Serve static frontend in production
const clientDist = path.join(__dirname, '../../client/dist');
app.use(express.static(clientDist));
app.get('*', (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Server] NPC-Shelf running on http://0.0.0.0:${PORT}`);
});

export default app;
