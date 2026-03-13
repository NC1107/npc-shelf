import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq, sql } from 'drizzle-orm';
import { jobQueue } from '../../db/schema/jobs.js';

// In-memory DB for testing query logic
const sqlite = new Database(':memory:');
sqlite.pragma('journal_mode = WAL');
const testDb = drizzle(sqlite, { schema: { jobQueue } });

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

describe('Jobs API Logic', () => {
  beforeEach(() => {
    sqlite.exec('DELETE FROM job_queue');
  });

  afterAll(() => {
    sqlite.close();
  });

  it('summary returns correct counts by status', () => {
    // Insert jobs with various statuses
    testDb.insert(jobQueue).values([
      { jobType: 'a', status: 'pending' },
      { jobType: 'b', status: 'pending' },
      { jobType: 'c', status: 'completed' },
      { jobType: 'd', status: 'failed', error: 'oops' },
    ]).run();

    const rows = sqlite.prepare('SELECT status, COUNT(*) as count FROM job_queue GROUP BY status').all() as { status: string; count: number }[];
    const summary: Record<string, number> = { pending: 0, processing: 0, completed: 0, failed: 0 };
    for (const row of rows) summary[row.status] = row.count;

    expect(summary.pending).toBe(2);
    expect(summary.completed).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.processing).toBe(0);
  });

  it('pagination works correctly', () => {
    // Insert 15 jobs
    for (let i = 0; i < 15; i++) {
      testDb.insert(jobQueue).values({ jobType: `job_${i}` }).run();
    }

    const total = (sqlite.prepare('SELECT COUNT(*) as count FROM job_queue').get() as { count: number }).count;
    expect(total).toBe(15);

    const page1 = testDb.select().from(jobQueue).limit(10).offset(0).all();
    expect(page1.length).toBe(10);

    const page2 = testDb.select().from(jobQueue).limit(10).offset(10).all();
    expect(page2.length).toBe(5);
  });

  it('filtering by status returns only matching jobs', () => {
    testDb.insert(jobQueue).values([
      { jobType: 'a', status: 'pending' },
      { jobType: 'b', status: 'completed' },
      { jobType: 'c', status: 'failed', error: 'err' },
    ]).run();

    const failed = testDb.select().from(jobQueue)
      .where(eq(jobQueue.status, 'failed'))
      .all();

    expect(failed.length).toBe(1);
    expect(failed[0]!.jobType).toBe('c');
  });
});
