import { eq, sql, asc } from 'drizzle-orm';
import { db, schema, sqlite } from '../db/index.js';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/**
 * Check if ffmpeg is available on the system.
 */
export function isFfmpegAvailable(): boolean {
  try {
    execSync('ffmpeg -version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Merge multiple audio files for a book into a single M4B file using ffmpeg concat.
 * Uses -c copy (no re-encoding) for fast operation.
 */
export async function mergeAudiobook(bookId: number): Promise<string> {
  if (!isFfmpegAvailable()) {
    throw new Error('ffmpeg is not installed. Install ffmpeg to merge audio tracks.');
  }

  // Get book info
  const book = db.select().from(schema.books).where(eq(schema.books.id, bookId)).get();
  if (!book) throw new Error(`Book ${bookId} not found`);

  // Get all audio tracks sorted by index
  const tracks = db
    .select()
    .from(schema.audioTracks)
    .where(eq(schema.audioTracks.bookId, bookId))
    .orderBy(asc(schema.audioTracks.trackIndex))
    .all();

  if (tracks.length <= 1) {
    throw new Error(`Book ${bookId} has ${tracks.length} track(s), nothing to merge`);
  }

  // Get file paths for each track
  const fileIds = [...new Set(tracks.map(t => t.fileId))];
  const files = db
    .select()
    .from(schema.files)
    .where(sql`${schema.files.id} IN (${sql.join(fileIds.map(id => sql`${id}`), sql`, `)})`)
    .all();

  const fileMap = new Map(files.map(f => [f.id, f]));

  // Build ordered list of file paths (one per track)
  const trackFiles: { path: string; file: typeof files[0] }[] = [];
  for (const track of tracks) {
    const file = fileMap.get(track.fileId);
    if (!file) throw new Error(`File ${track.fileId} not found for track ${track.trackIndex}`);
    if (!fs.existsSync(file.path)) throw new Error(`File not found on disk: ${file.path}`);
    trackFiles.push({ path: file.path, file });
  }

  // Determine output path — save next to original files
  const firstFile = trackFiles[0]!.file;
  const outputDir = path.dirname(firstFile.path);
  const safeTitle = book.title.replace(/[<>:"/\\|?*]/g, '_').substring(0, 100);
  const outputPath = path.join(outputDir, `${safeTitle} [merged].m4b`);

  // Create ffmpeg concat list in temp dir
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'npc-merge-'));
  const concatListPath = path.join(tmpDir, 'concat.txt');

  try {
    // Write concat list
    const concatContent = trackFiles
      .map(tf => `file '${tf.path.replace(/'/g, "'\\''")}'`)
      .join('\n');
    fs.writeFileSync(concatListPath, concatContent, 'utf-8');

    console.log(`[AudioMerge] Merging ${trackFiles.length} tracks for "${book.title}" → ${outputPath}`);

    // Run ffmpeg concat
    execSync(
      `ffmpeg -f concat -safe 0 -i "${concatListPath}" -c copy -y "${outputPath}"`,
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 600000, // 10 min timeout
      },
    );

    if (!fs.existsSync(outputPath)) {
      throw new Error('ffmpeg completed but output file not found');
    }

    const stat = fs.statSync(outputPath);
    console.log(`[AudioMerge] Merged file: ${outputPath} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);

    // Compute total duration from tracks
    const totalDuration = tracks.reduce((sum, t) => sum + t.durationSeconds, 0);

    // Update database atomically
    const updateDb = sqlite.transaction(() => {
      // 1. Insert a new file record for the merged file
      db.insert(schema.files).values({
        bookId,
        libraryId: firstFile.libraryId,
        path: outputPath,
        filename: path.basename(outputPath),
        format: 'm4b',
        mimeType: 'audio/mp4',
        sizeBytes: stat.size,
        hashSha256: 'merged',
        lastModified: stat.mtime.toISOString(),
      }).run();

      const newFile = db
        .select()
        .from(schema.files)
        .where(eq(schema.files.path, outputPath))
        .get()!;

      // 2. Delete old audio tracks and replace with single track
      db.delete(schema.audioTracks).where(eq(schema.audioTracks.bookId, bookId)).run();
      db.insert(schema.audioTracks).values({
        bookId,
        fileId: newFile.id,
        trackIndex: 0,
        title: book.title,
        durationSeconds: totalDuration,
        startOffsetSeconds: 0,
      }).run();

      // 3. Delete old split file records (keep original files on disk)
      for (const tf of trackFiles) {
        db.delete(schema.files).where(eq(schema.files.id, tf.file.id)).run();
      }

      // 4. Update book audioSeconds
      db.update(schema.books)
        .set({ audioSeconds: totalDuration, updatedAt: new Date().toISOString() })
        .where(eq(schema.books.id, bookId))
        .run();
    });

    try {
      updateDb();
    } catch (dbError) {
      // Transaction failed — clean up the output file to avoid orphan
      try { fs.unlinkSync(outputPath); } catch { /* ignore */ }
      throw dbError;
    }

    return outputPath;
  } finally {
    // Clean up temp dir
    try {
      fs.rmSync(tmpDir, { recursive: true });
    } catch { /* ignore */ }
  }
}
