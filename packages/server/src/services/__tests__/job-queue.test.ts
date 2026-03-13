import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import { jobQueue } from '../../db/schema/jobs.js';

// Use an in-memory database for tests
const sqlite = new Database(':memory:');
sqlite.pragma('journal_mode = WAL');
const testDb = drizzle(sqlite, { schema: { jobQueue } });

// Create table
sqlite.exec(`
  CREATE TABLE job_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_type TEXT NOT NULL,
    payload TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'completed', 'failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    error TEXT,
    scheduled_for TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

describe('Job Queue', () => {
  beforeEach(() => {
    sqlite.exec('DELETE FROM job_queue');
  });

  afterAll(() => {
    sqlite.close();
  });

  it('enqueue creates a pending job', () => {
    testDb.insert(jobQueue)
      .values({ jobType: 'test_job', payload: JSON.stringify({ bookId: 1 }) })
      .run();

    const job = testDb.select().from(jobQueue).get();
    expect(job).toBeTruthy();
    expect(job!.status).toBe('pending');
    expect(job!.jobType).toBe('test_job');
    expect(job!.attempts).toBe(0);
  });

  it('job transitions through lifecycle: pending → processing → completed', () => {
    const inserted = testDb.insert(jobQueue)
      .values({ jobType: 'lifecycle_test' })
      .returning()
      .get();

    // Claim
    testDb.update(jobQueue)
      .set({ status: 'processing', attempts: 1 })
      .where(eq(jobQueue.id, inserted.id))
      .run();

    let job = testDb.select().from(jobQueue).where(eq(jobQueue.id, inserted.id)).get()!;
    expect(job.status).toBe('processing');
    expect(job.attempts).toBe(1);

    // Complete
    testDb.update(jobQueue)
      .set({ status: 'completed' })
      .where(eq(jobQueue.id, inserted.id))
      .run();

    job = testDb.select().from(jobQueue).where(eq(jobQueue.id, inserted.id)).get()!;
    expect(job.status).toBe('completed');
  });

  it('failed job can be retried by resetting status', () => {
    const inserted = testDb.insert(jobQueue)
      .values({ jobType: 'fail_test', status: 'failed', attempts: 3, error: 'some error' })
      .returning()
      .get();

    // Retry: reset
    testDb.update(jobQueue)
      .set({ status: 'pending', attempts: 0, error: null })
      .where(eq(jobQueue.id, inserted.id))
      .run();

    const job = testDb.select().from(jobQueue).where(eq(jobQueue.id, inserted.id)).get()!;
    expect(job.status).toBe('pending');
    expect(job.attempts).toBe(0);
    expect(job.error).toBeNull();
  });

  it('max_attempts defaults to 3', () => {
    const inserted = testDb.insert(jobQueue)
      .values({ jobType: 'default_test' })
      .returning()
      .get();

    expect(inserted.maxAttempts).toBe(3);
  });
});
