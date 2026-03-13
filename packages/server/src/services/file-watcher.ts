import chokidar, { type FSWatcher } from 'chokidar';
import { SUPPORTED_FORMATS } from '@npc-shelf/shared';
import { db, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';

const watchers = new Map<number, FSWatcher>();
const debounceTimers = new Map<number, ReturnType<typeof setTimeout>>();

const DEBOUNCE_MS = 5000;
const SUPPORTED_EXTENSIONS = new Set(SUPPORTED_FORMATS.map(f => `.${f}`));

function isSupported(filePath: string): boolean {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
  return SUPPORTED_EXTENSIONS.has(ext);
}

/**
 * Start watching a library directory for file changes.
 * Debounces changes and queues a scan_library job.
 */
export function startWatching(libraryId: number, libraryPath: string): void {
  // Stop any existing watcher for this library
  stopWatching(libraryId);

  try {
    const watcher = chokidar.watch(libraryPath, {
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 500 },
      depth: 10,
    });

    watcher.on('add', (path) => {
      if (isSupported(path)) {
        console.log(`[FileWatcher] New file detected: ${path}`);
        debounceScan(libraryId);
      }
    });

    watcher.on('unlink', (path) => {
      if (isSupported(path)) {
        console.log(`[FileWatcher] File removed: ${path}`);
        debounceScan(libraryId);
      }
    });

    watcher.on('change', (path) => {
      if (isSupported(path)) {
        console.log(`[FileWatcher] File changed: ${path}`);
        debounceScan(libraryId);
      }
    });

    watcher.on('error', (err) => {
      console.error(`[FileWatcher] Error watching library ${libraryId}:`, err);
    });

    watchers.set(libraryId, watcher);
    console.log(`[FileWatcher] Watching library ${libraryId}: ${libraryPath}`);
  } catch (err) {
    console.error(`[FileWatcher] Failed to start watcher for library ${libraryId}:`, err);
  }
}

/**
 * Stop watching a library directory.
 */
export function stopWatching(libraryId: number): void {
  const existing = watchers.get(libraryId);
  if (existing) {
    existing.close().catch(() => {});
    watchers.delete(libraryId);
    console.log(`[FileWatcher] Stopped watching library ${libraryId}`);
  }
  const timer = debounceTimers.get(libraryId);
  if (timer) {
    clearTimeout(timer);
    debounceTimers.delete(libraryId);
  }
}

/**
 * Stop all active watchers.
 */
export function stopAllWatchers(): void {
  for (const [id] of watchers) {
    stopWatching(id);
  }
}

/**
 * Debounce scan: collect file events for DEBOUNCE_MS, then queue a single scan job.
 */
function debounceScan(libraryId: number): void {
  const existing = debounceTimers.get(libraryId);
  if (existing) clearTimeout(existing);

  debounceTimers.set(
    libraryId,
    setTimeout(() => {
      debounceTimers.delete(libraryId);
      queueScan(libraryId);
    }, DEBOUNCE_MS),
  );
}

function queueScan(libraryId: number): void {
  try {
    // Check if there's already a pending/processing scan for this library
    const existingJob = db
      .select({ id: schema.jobQueue.id })
      .from(schema.jobQueue)
      .where(
        eq(schema.jobQueue.jobType, 'scan_library'),
      )
      .all()
      .find((j: any) => {
        const raw = db.select().from(schema.jobQueue).where(eq(schema.jobQueue.id, j.id)).get() as any;
        if (!raw || (raw.status !== 'pending' && raw.status !== 'processing')) return false;
        try {
          const payload = JSON.parse(raw.payload);
          return payload.libraryId === libraryId;
        } catch { return false; }
      });

    if (existingJob) {
      console.log(`[FileWatcher] Scan already pending for library ${libraryId}, skipping`);
      return;
    }

    db.insert(schema.jobQueue)
      .values({
        jobType: 'scan_library',
        payload: JSON.stringify({ libraryId }),
      })
      .run();
    console.log(`[FileWatcher] Queued scan for library ${libraryId}`);
  } catch (err) {
    console.error(`[FileWatcher] Failed to queue scan for library ${libraryId}:`, err);
  }
}

/**
 * Initialize watchers for all libraries with scanEnabled=true.
 */
export function initializeWatchers(): void {
  try {
    const libraries = db
      .select()
      .from(schema.libraries)
      .where(eq(schema.libraries.scanEnabled, true))
      .all();

    for (const lib of libraries) {
      startWatching(lib.id, lib.path);
    }

    if (libraries.length > 0) {
      console.log(`[FileWatcher] Initialized watchers for ${libraries.length} libraries`);
    }
  } catch (err) {
    console.error('[FileWatcher] Failed to initialize watchers:', err);
  }
}
