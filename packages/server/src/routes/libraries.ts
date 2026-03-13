import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { activeScanStatuses } from '../services/scanner.js';
import fs from 'node:fs';
import path from 'node:path';
import { SUPPORTED_EBOOK_FORMATS, SUPPORTED_AUDIO_FORMATS } from '@npc-shelf/shared';

export const librariesRouter = Router();

// Browse directories for library setup
librariesRouter.get('/browse', (req, res) => {
  try {
    const requestedPath = (req.query.path as string) || (process.platform === 'win32' ? 'C:/' : '/');
    const normalizedPath = path.resolve(requestedPath);

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(normalizedPath, { withFileTypes: true });
    } catch {
      res.status(400).json({ error: 'Cannot read directory' });
      return;
    }

    const audioExts = new Set(SUPPORTED_AUDIO_FORMATS.map((f) => `.${f}`));
    const ebookExts = new Set(SUPPORTED_EBOOK_FORMATS.map((f) => `.${f}`));

    const directories: { name: string; path: string }[] = [];
    let audioFiles = 0;
    let ebookFiles = 0;

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue; // skip hidden
      try {
        if (entry.isDirectory()) {
          directories.push({ name: entry.name, path: path.join(normalizedPath, entry.name) });
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (audioExts.has(ext)) audioFiles++;
          if (ebookExts.has(ext)) ebookFiles++;
        }
      } catch {
        // skip entries we can't stat
      }
    }

    directories.sort((a, b) => a.name.localeCompare(b.name));

    const parentPath = path.dirname(normalizedPath);
    res.json({
      currentPath: normalizedPath,
      parent: parentPath !== normalizedPath ? parentPath : null,
      directories,
      audioFiles,
      ebookFiles,
    });
  } catch (error) {
    console.error('[Libraries] Browse error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// List libraries
librariesRouter.get('/', (_req, res) => {
  try {
    const libraries = db.select().from(schema.libraries).all();
    res.json(libraries);
  } catch (error) {
    console.error('[Libraries] List error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add library
librariesRouter.post('/', (req, res) => {
  try {
    const { name, path: libPath, type } = req.body;
    if (!name || !libPath) {
      res.status(400).json({ error: 'Name and path are required' });
      return;
    }

    // Verify path exists
    if (!fs.existsSync(libPath)) {
      res.status(400).json({ error: 'Path does not exist' });
      return;
    }

    const library = db
      .insert(schema.libraries)
      .values({ name, path: libPath, type: type || 'mixed' })
      .returning()
      .get();

    res.status(201).json(library);
  } catch (error: any) {
    if (error?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      res.status(409).json({ error: 'Library path already exists' });
      return;
    }
    console.error('[Libraries] Create error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update library
librariesRouter.put('/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { name, type, scanEnabled } = req.body;

    const existing = db.select().from(schema.libraries).where(eq(schema.libraries.id, id)).get();
    if (!existing) {
      res.status(404).json({ error: 'Library not found' });
      return;
    }

    const updated = db
      .update(schema.libraries)
      .set({
        ...(name !== undefined && { name }),
        ...(type !== undefined && { type }),
        ...(scanEnabled !== undefined && { scanEnabled }),
      })
      .where(eq(schema.libraries.id, id))
      .returning()
      .get();

    res.json(updated);
  } catch (error) {
    console.error('[Libraries] Update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete library
librariesRouter.delete('/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const existing = db.select().from(schema.libraries).where(eq(schema.libraries.id, id)).get();
    if (!existing) {
      res.status(404).json({ error: 'Library not found' });
      return;
    }

    db.delete(schema.libraries).where(eq(schema.libraries.id, id)).run();
    res.json({ message: 'Library removed' });
  } catch (error) {
    console.error('[Libraries] Delete error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Trigger scan
librariesRouter.post('/:id/scan', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const library = db.select().from(schema.libraries).where(eq(schema.libraries.id, id)).get();
    if (!library) {
      res.status(404).json({ error: 'Library not found' });
      return;
    }

    // Queue a scan job
    db.insert(schema.jobQueue)
      .values({
        jobType: 'scan_library',
        payload: JSON.stringify({ libraryId: id }),
      })
      .run();

    res.json({ message: 'Scan queued', libraryId: id });
  } catch (error) {
    console.error('[Libraries] Scan error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Scan status — SSE stream for real-time progress, falls back to JSON poll
librariesRouter.get('/:id/scan/status', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const library = db.select().from(schema.libraries).where(eq(schema.libraries.id, id)).get();
    if (!library) {
      res.status(404).json({ error: 'Library not found' });
      return;
    }

    const wantsSSE = req.headers.accept?.includes('text/event-stream');

    if (wantsSSE) {
      // SSE mode — stream progress updates
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      const interval = setInterval(() => {
        const status = activeScanStatuses.get(id);
        if (status) {
          res.write(`data: ${JSON.stringify(status)}\n\n`);
          if (status.status === 'complete' || status.status === 'error') {
            clearInterval(interval);
            res.write(`data: ${JSON.stringify(status)}\n\n`);
            res.end();
          }
        } else {
          // No active scan — send idle status
          res.write(`data: ${JSON.stringify({ libraryId: id, status: 'idle', lastScannedAt: library.lastScannedAt })}\n\n`);
          clearInterval(interval);
          res.end();
        }
      }, 1000);

      req.on('close', () => clearInterval(interval));
    } else {
      // JSON poll mode
      const status = activeScanStatuses.get(id);
      if (status) {
        res.json(status);
      } else {
        // Check for pending jobs
        const activeJob = db
          .select()
          .from(schema.jobQueue)
          .where(eq(schema.jobQueue.jobType, 'scan_library'))
          .all()
          .find((j) => {
            const payload = JSON.parse(j.payload);
            return payload.libraryId === id && (j.status === 'pending' || j.status === 'processing');
          });

        res.json({
          libraryId: id,
          status: activeJob ? (activeJob.status === 'processing' ? 'scanning' : 'pending') : 'idle',
          filesFound: 0,
          filesProcessed: 0,
          booksAdded: 0,
          booksUpdated: 0,
          errors: [],
          startedAt: null,
          completedAt: null,
          lastScannedAt: library.lastScannedAt,
        });
      }
    }
  } catch (error) {
    console.error('[Libraries] Scan status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
