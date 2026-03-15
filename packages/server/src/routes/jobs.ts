import { Router } from 'express';
import { eq, sql, and, lte } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

export const jobsRouter = Router();

// List recent jobs (paginated, filterable by status)
jobsRouter.get('/', (req, res) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(req.query.pageSize as string) || 20));
    const status = req.query.status as string | undefined;

    const conditions = status ? eq(schema.jobQueue.status, status as 'pending' | 'processing' | 'completed' | 'failed') : undefined;

    const total = db
      .select({ count: sql<number>`count(*)` })
      .from(schema.jobQueue)
      .where(conditions)
      .get()!.count;

    const items = db
      .select()
      .from(schema.jobQueue)
      .where(conditions)
      .orderBy(sql`${schema.jobQueue.createdAt} DESC`)
      .limit(pageSize)
      .offset((page - 1) * pageSize)
      .all();

    res.json({
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (error) {
    console.error('[Jobs] List error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Job summary — counts by status
jobsRouter.get('/summary', (_req, res) => {
  try {
    const rows = db
      .all<{ status: string; count: number }>(
        sql`SELECT status, COUNT(*) as count FROM job_queue GROUP BY status`,
      );

    const summary: Record<string, number> = {
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
    };
    for (const row of rows) {
      summary[row.status] = row.count;
    }

    res.json(summary);
  } catch (error) {
    console.error('[Jobs] Summary error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get active/recent jobs for a specific book
jobsRouter.get('/book/:bookId', (req, res) => {
  try {
    const bookId = Number.parseInt(req.params.bookId);
    if (Number.isNaN(bookId)) { res.status(400).json({ error: 'Invalid book ID' }); return; }

    const items = db
      .select()
      .from(schema.jobQueue)
      .where(
        sql`json_extract(${schema.jobQueue.payload}, '$.bookId') = ${bookId}`,
      )
      .orderBy(sql`${schema.jobQueue.createdAt} DESC`)
      .limit(10)
      .all();

    res.json(items);
  } catch (error) {
    console.error('[Jobs] Book jobs error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Retry a failed job
jobsRouter.post('/:id/retry', (req, res) => {
  try {
    const jobId = Number.parseInt(req.params.id);
    if (Number.isNaN(jobId)) { res.status(400).json({ error: 'Invalid job ID' }); return; }

    const job = db.select().from(schema.jobQueue).where(eq(schema.jobQueue.id, jobId)).get();
    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }

    if (job.status !== 'failed') {
      res.status(400).json({ error: 'Only failed jobs can be retried' });
      return;
    }

    db.update(schema.jobQueue)
      .set({
        status: 'pending',
        error: null,
        attempts: 0,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.jobQueue.id, jobId))
      .run();

    res.json({ message: 'Job requeued' });
  } catch (error) {
    console.error('[Jobs] Retry error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Purge old completed/failed jobs
jobsRouter.delete('/purge', (req, res) => {
  try {
    const days = Math.max(1, Number.parseInt(req.query.days as string) || 7);
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const result = db.delete(schema.jobQueue)
      .where(
        and(
          sql`${schema.jobQueue.status} IN ('completed', 'failed')`,
          lte(schema.jobQueue.updatedAt, cutoff),
        ),
      )
      .run();

    res.json({ deleted: result.changes });
  } catch (error) {
    console.error('[Jobs] Purge error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
