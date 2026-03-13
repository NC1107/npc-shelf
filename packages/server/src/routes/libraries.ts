import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import fs from 'node:fs';

export const librariesRouter = Router();

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

// Scan status
librariesRouter.get('/:id/scan/status', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const library = db.select().from(schema.libraries).where(eq(schema.libraries.id, id)).get();
    if (!library) {
      res.status(404).json({ error: 'Library not found' });
      return;
    }

    // Check for active scan jobs
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
      lastScannedAt: library.lastScannedAt,
    });
  } catch (error) {
    console.error('[Libraries] Scan status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
