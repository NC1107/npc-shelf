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

/**
 * Check if an active (pending or processing) job exists for a given type and bookId.
 * Uses json_extract to match bookId in the payload JSON.
 */
export function hasActiveJob(jobType: string, bookId: number): boolean {
  const job = db
    .select({ id: schema.jobQueue.id })
    .from(schema.jobQueue)
    .where(
      sql`${schema.jobQueue.jobType} = ${jobType}
        AND ${schema.jobQueue.status} IN ('pending', 'processing')
        AND json_extract(${schema.jobQueue.payload}, '$.bookId') = ${bookId}`,
    )
    .limit(1)
    .get();
  return !!job;
}

/**
 * Recover jobs left in 'processing' state from a previous server run.
 * Must be called at startup before startJobProcessor().
 */
export function recoverStaleJobs() {
  const staleJobs = db
    .select()
    .from(schema.jobQueue)
    .where(eq(schema.jobQueue.status, 'processing'))
    .all();

  if (staleJobs.length === 0) return;

  const now = new Date().toISOString();
  for (const job of staleJobs) {
    if (job.attempts >= job.maxAttempts) {
      db.update(schema.jobQueue)
        .set({
          status: 'failed',
          error: 'Server restarted while job was processing',
          updatedAt: now,
        })
        .where(eq(schema.jobQueue.id, job.id))
        .run();
      console.warn(`[JobQueue] Stale job ${job.id} (${job.jobType}) marked failed — max attempts reached`);
    } else {
      db.update(schema.jobQueue)
        .set({ status: 'pending', updatedAt: now })
        .where(eq(schema.jobQueue.id, job.id))
        .run();
      console.warn(`[JobQueue] Stale job ${job.id} (${job.jobType}) reset to pending (attempt ${job.attempts}/${job.maxAttempts})`);
    }
  }
  console.log(`[JobQueue] Recovered ${staleJobs.length} stale job(s)`);
}

let pollInterval: NodeJS.Timeout | null = null;
let stopping = false;
let currentJobPromise: Promise<boolean> | null = null;

async function processNextJob(): Promise<boolean> {
  if (stopping) return false;

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

export function startJobProcessor() {
  if (pollInterval) return;
  stopping = false;

  console.log('[JobQueue] Starting job processor');
  pollInterval = setInterval(async () => {
    if (stopping) return;
    try {
      let processed = true;
      while (processed && !stopping) {
        currentJobPromise = processNextJob();
        processed = await currentJobPromise;
        currentJobPromise = null;
      }
    } catch (error) {
      console.error('[JobQueue] Processing error:', error);
      currentJobPromise = null;
    }
  }, JOB_QUEUE.POLL_INTERVAL_MS);
}

export async function stopJobProcessor() {
  stopping = true;
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
  // Wait for in-flight job to complete (up to 30s)
  if (currentJobPromise) {
    console.log('[JobQueue] Waiting for in-flight job to complete...');
    try {
      await Promise.race([
        currentJobPromise,
        new Promise(resolve => setTimeout(resolve, 30000)),
      ]);
    } catch {
      // Job error is already handled in processNextJob
    }
  }
  console.log('[JobQueue] Job processor stopped');
}
