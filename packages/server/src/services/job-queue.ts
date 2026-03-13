import { eq, sql, and, lte } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { JOB_QUEUE } from '@npc-shelf/shared';

type JobHandler = (payload: Record<string, unknown>) => Promise<void>;

const handlers = new Map<string, JobHandler>();

export function registerJobHandler(jobType: string, handler: JobHandler) {
  handlers.set(jobType, handler);
}

export function enqueueJob(
  jobType: string,
  payload: Record<string, unknown> = {},
  maxAttempts = JOB_QUEUE.MAX_ATTEMPTS,
) {
  db.insert(schema.jobQueue)
    .values({
      jobType,
      payload: JSON.stringify(payload),
      maxAttempts,
    })
    .run();
}

async function processNextJob(): Promise<boolean> {
  const now = new Date().toISOString();

  // Find and claim the next pending job
  const job = db
    .select()
    .from(schema.jobQueue)
    .where(
      and(
        eq(schema.jobQueue.status, 'pending'),
        lte(schema.jobQueue.scheduledFor, now),
      ),
    )
    .limit(1)
    .get();

  if (!job) return false;

  // Claim the job
  db.update(schema.jobQueue)
    .set({ status: 'processing', attempts: job.attempts + 1, updatedAt: now })
    .where(eq(schema.jobQueue.id, job.id))
    .run();

  const handler = handlers.get(job.jobType);
  if (!handler) {
    db.update(schema.jobQueue)
      .set({ status: 'failed', error: `No handler for job type: ${job.jobType}`, updatedAt: now })
      .where(eq(schema.jobQueue.id, job.id))
      .run();
    return true;
  }

  try {
    const payload = JSON.parse(job.payload);
    await handler(payload);
    db.update(schema.jobQueue)
      .set({ status: 'completed', updatedAt: new Date().toISOString() })
      .where(eq(schema.jobQueue.id, job.id))
      .run();
  } catch (error: any) {
    const errorMsg = error?.message || String(error);
    const newStatus = job.attempts + 1 >= job.maxAttempts ? 'failed' : 'pending';
    db.update(schema.jobQueue)
      .set({
        status: newStatus as 'pending' | 'failed',
        error: errorMsg,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.jobQueue.id, job.id))
      .run();
  }

  return true;
}

let pollInterval: NodeJS.Timeout | null = null;

export function startJobProcessor() {
  if (pollInterval) return;

  console.log('[JobQueue] Starting job processor');
  pollInterval = setInterval(async () => {
    try {
      let processed = true;
      while (processed) {
        processed = await processNextJob();
      }
    } catch (error) {
      console.error('[JobQueue] Processing error:', error);
    }
  }, JOB_QUEUE.POLL_INTERVAL_MS);
}

export function stopJobProcessor() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}
