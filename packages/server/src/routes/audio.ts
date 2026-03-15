import { Router } from 'express';
import { eq, sql } from 'drizzle-orm';
import { db, schema, sqlite } from '../db/index.js';
import { enqueueJob, hasActiveJob } from '../services/job-queue.js';
import { isFfmpegAvailable } from '../services/audio-merge.js';
import fs from 'node:fs';

export const audioRouter = Router();

// Stream audio track (supports HTTP Range)
audioRouter.get('/:id/stream/:trackIndex', (req, res) => {
  try {
    const bookId = Number.parseInt(req.params.id);
    if (Number.isNaN(bookId)) { res.status(400).json({ error: 'Invalid book ID' }); return; }
    const trackIndex = Number.parseInt(req.params.trackIndex);
    if (Number.isNaN(trackIndex)) { res.status(400).json({ error: 'Invalid track index' }); return; }

    const track = db
      .select()
      .from(schema.audioTracks)
      .where(
        sql`${schema.audioTracks.bookId} = ${bookId} AND ${schema.audioTracks.trackIndex} = ${trackIndex}`,
      )
      .get();

    if (!track) {
      res.status(404).json({ error: 'Track not found' });
      return;
    }

    const file = db
      .select()
      .from(schema.files)
      .where(eq(schema.files.id, track.fileId))
      .get();

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
        'Content-Type': file.mimeType,
      });

      const stream = fs.createReadStream(file.path, { start, end });
      stream.pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': file.mimeType,
        'Accept-Ranges': 'bytes',
      });
      fs.createReadStream(file.path).pipe(res);
    }
  } catch (error) {
    console.error('[Audio] Stream error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get tracks for a book
audioRouter.get('/:id/tracks', (req, res) => {
  try {
    const bookId = Number.parseInt(req.params.id);
    if (Number.isNaN(bookId)) { res.status(400).json({ error: 'Invalid book ID' }); return; }
    const tracks = db
      .select()
      .from(schema.audioTracks)
      .where(eq(schema.audioTracks.bookId, bookId))
      .all();
    res.json(tracks);
  } catch (error) {
    console.error('[Audio] Tracks error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get chapters
audioRouter.get('/:id/chapters', (req, res) => {
  try {
    const bookId = Number.parseInt(req.params.id);
    if (Number.isNaN(bookId)) { res.status(400).json({ error: 'Invalid book ID' }); return; }
    const chapters = db
      .select()
      .from(schema.audioChapters)
      .where(eq(schema.audioChapters.bookId, bookId))
      .all();
    res.json(chapters);
  } catch (error) {
    console.error('[Audio] Chapters error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update chapters
audioRouter.put('/:id/chapters', (req, res) => {
  try {
    const bookId = Number.parseInt(req.params.id);
    if (Number.isNaN(bookId)) { res.status(400).json({ error: 'Invalid book ID' }); return; }

    const { chapters } = req.body as {
      chapters?: { title: string; startTime: number; endTime: number; trackIndex: number }[];
    };
    if (!Array.isArray(chapters)) {
      res.status(400).json({ error: 'chapters array is required' });
      return;
    }

    const updateTx = sqlite.transaction(() => {
      // Delete existing chapters for this book
      db.delete(schema.audioChapters).where(eq(schema.audioChapters.bookId, bookId)).run();

      // Insert new chapters
      for (const ch of chapters) {
        db.insert(schema.audioChapters).values({
          bookId,
          title: ch.title,
          startTime: ch.startTime,
          endTime: ch.endTime,
          trackIndex: ch.trackIndex,
        }).run();
      }
    });

    updateTx();

    const updated = db.select().from(schema.audioChapters)
      .where(eq(schema.audioChapters.bookId, bookId)).all();
    res.json(updated);
  } catch (error) {
    console.error('[Audio] Update chapters error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get progress
audioRouter.get('/:id/progress', (req, res) => {
  try {
    const bookId = Number.parseInt(req.params.id);
    if (Number.isNaN(bookId)) { res.status(400).json({ error: 'Invalid book ID' }); return; }
    const userId = req.user!.userId;

    const progress = db
      .select()
      .from(schema.audioProgress)
      .where(
        sql`${schema.audioProgress.userId} = ${userId} AND ${schema.audioProgress.bookId} = ${bookId}`,
      )
      .get();

    res.json(progress || null);
  } catch (error) {
    console.error('[Audio] Progress error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update progress
audioRouter.put('/:id/progress', (req, res) => {
  try {
    const bookId = Number.parseInt(req.params.id);
    if (Number.isNaN(bookId)) { res.status(400).json({ error: 'Invalid book ID' }); return; }
    const userId = req.user!.userId;
    const { currentTrackIndex, positionSeconds, totalElapsedSeconds, totalDurationSeconds, playbackRate, isFinished } = req.body;

    const existing = db
      .select()
      .from(schema.audioProgress)
      .where(
        sql`${schema.audioProgress.userId} = ${userId} AND ${schema.audioProgress.bookId} = ${bookId}`,
      )
      .get();

    if (existing) {
      db.update(schema.audioProgress)
        .set({
          currentTrackIndex,
          positionSeconds,
          totalElapsedSeconds,
          totalDurationSeconds,
          playbackRate,
          isFinished,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(schema.audioProgress.id, existing.id))
        .run();
    } else {
      db.insert(schema.audioProgress)
        .values({
          userId,
          bookId,
          currentTrackIndex,
          positionSeconds,
          totalElapsedSeconds,
          totalDurationSeconds,
          playbackRate,
          isFinished,
        })
        .run();
    }

    res.json({ message: 'Progress updated' });
  } catch (error) {
    console.error('[Audio] Update progress error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Merge split audiobook into single M4B
audioRouter.post('/:id/merge', (req, res) => {
  try {
    const bookId = Number.parseInt(req.params.id);
    if (Number.isNaN(bookId)) { res.status(400).json({ error: 'Invalid book ID' }); return; }

    const book = db.select().from(schema.books).where(eq(schema.books.id, bookId)).get();
    if (!book) { res.status(404).json({ error: 'Book not found' }); return; }

    // Check track count
    const trackCount = db
      .select({ count: sql<number>`count(*)` })
      .from(schema.audioTracks)
      .where(eq(schema.audioTracks.bookId, bookId))
      .get()!.count;

    if (trackCount <= 1) {
      res.status(400).json({ error: 'Book has only one audio track, nothing to merge' });
      return;
    }

    // Check ffmpeg availability
    if (!isFfmpegAvailable()) {
      res.status(400).json({ error: 'ffmpeg is not available on this system. Install ffmpeg to use the merge feature.' });
      return;
    }

    // Check for existing merge job
    if (hasActiveJob('merge_audiobook', bookId)) {
      res.status(409).json({ error: 'A merge job is already queued or in progress for this book' });
      return;
    }

    // Queue merge job
    enqueueJob('merge_audiobook', { bookId });
    res.status(202).json({ message: 'Merge job queued' });
  } catch (error) {
    console.error('[Audio] Merge error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
