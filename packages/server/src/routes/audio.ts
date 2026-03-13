import { Router } from 'express';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import fs from 'node:fs';
import path from 'node:path';

export const audioRouter = Router();

// Stream audio track (supports HTTP Range)
audioRouter.get('/:id/stream/:trackIndex', (req, res) => {
  try {
    const bookId = parseInt(req.params.id);
    const trackIndex = parseInt(req.params.trackIndex);

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
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
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

// Get chapters
audioRouter.get('/:id/chapters', (req, res) => {
  try {
    const bookId = parseInt(req.params.id);
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

// Get progress
audioRouter.get('/:id/progress', (req, res) => {
  try {
    const bookId = parseInt(req.params.id);
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
    const bookId = parseInt(req.params.id);
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
