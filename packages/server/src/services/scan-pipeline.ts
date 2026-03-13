import fs from 'node:fs';
import path from 'node:path';
import { SUPPORTED_FORMATS, SUPPORTED_AUDIO_FORMATS } from '@npc-shelf/shared';
import { parseFilenameEnhanced, type FilenameHints } from '../utils/filename-parser.js';
import { parseSidecarMetadata, type SidecarMetadata } from './sidecar-parser.js';

// --- Internal types ---

export interface FileCandidate {
  path: string;
  filename: string;
  extension: string;
  directory: string;
  size: number;
  modifiedTime: string;
  isAudio: boolean;
}

export interface DirectoryHints {
  authorHint: string | null;
  seriesHint: string | null;
  titleHint: string | null;
  confidence: number;
}

export interface BookCandidate {
  files: FileCandidate[];
  directoryHints: DirectoryHints;
  filenameHints: FilenameHints;
  sidecarMeta: SidecarMetadata | null;
  resolvedTitle: string;
  resolvedAuthor: string | null;
  resolvedSeries: string | null;
  resolvedSeriesPosition: number | null;
  resolvedSeriesList: { name: string; position: number | null }[];
  isAudiobook: boolean;
  coverSource: 'sidecar' | null;
}

// --- Pass 1: File Discovery ---

export function discoverFiles(libraryPath: string): FileCandidate[] {
  const results: FileCandidate[] = [];
  const extensions = SUPPORTED_FORMATS.map((f) => `.${f}`);
  const audioExtensions = new Set(SUPPORTED_AUDIO_FORMATS.map((f) => `.${f}`));

  function walk(dir: string) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (extensions.includes(ext)) {
          let stat: fs.Stats;
          try {
            stat = fs.statSync(fullPath);
          } catch {
            continue;
          }
          results.push({
            path: fullPath,
            filename: entry.name,
            extension: ext.slice(1),
            directory: dir,
            size: stat.size,
            modifiedTime: stat.mtime.toISOString(),
            isAudio: audioExtensions.has(ext),
          });
        }
      }
    }
  }

  walk(libraryPath);
  return results;
}

// --- Pass 2: Directory Context Inference ---

export function inferDirectoryContext(candidate: FileCandidate, libraryRoot: string): DirectoryHints {
  const relativePath = path.relative(libraryRoot, candidate.path);
  const segments = relativePath.split(/[/\\]/).filter(Boolean);
  // segments: [...directories, filename] — remove filename
  segments.pop();

  const result: DirectoryHints = {
    authorHint: null,
    seriesHint: null,
    titleHint: null,
    confidence: 0.5,
  };

  if (segments.length === 0) {
    // File directly in library root — no directory hints
    result.confidence = 0;
    return result;
  }

  if (segments.length === 1) {
    // e.g., Author/file.epub
    result.authorHint = segments[0]!;
  } else if (segments.length === 2) {
    // e.g., Author/Book/file.m4b
    result.authorHint = segments[0]!;
    result.titleHint = segments[1]!;
  } else {
    // e.g., Author/Series/Book/file.m4b
    result.authorHint = segments[0]!;
    result.seriesHint = segments[1]!;
    result.titleHint = segments[2]!;
  }

  // Validate author hint looks like a person name
  if (result.authorHint) {
    if (looksLikePersonName(result.authorHint)) {
      result.confidence += 0.2;
    }
    // Common patterns boost
    if (segments.length >= 2) {
      result.confidence += 0.1;
    }
  }

  return result;
}

function looksLikePersonName(name: string): boolean {
  // Contains space (first + last), no numbers, not too long
  return name.includes(' ') && !/\d/.test(name) && name.length < 50;
}

// --- Pass 3: Filename Parsing ---
// Delegated to parseFilenameEnhanced() in filename-parser.ts

// --- Pass 4: File Grouping into BookCandidates ---

export function groupIntoCandidates(
  files: FileCandidate[],
  directoryHintsMap: Map<string, DirectoryHints>,
  filenameHintsMap: Map<string, FilenameHints>,
  libraryRoot: string,
): BookCandidate[] {
  const candidates: BookCandidate[] = [];
  const consumed = new Set<string>();

  // Separate audio and ebook files
  const audioFiles = files.filter((f) => f.isAudio);
  const ebookFiles = files.filter((f) => !f.isAudio);

  // --- A. Audio directory grouping ---
  // Group audio files by directory
  const audioDirMap = new Map<string, FileCandidate[]>();
  for (const file of audioFiles) {
    const dir = file.directory;
    if (!audioDirMap.has(dir)) audioDirMap.set(dir, []);
    audioDirMap.get(dir)!.push(file);
  }

  for (const [dir, dirFiles] of audioDirMap) {
    if (dirFiles.length >= 1) {
      // Sort files naturally by filename (numeric prefix)
      dirFiles.sort((a, b) => naturalCompare(a.filename, b.filename));

      // Mark all as consumed
      for (const f of dirFiles) consumed.add(f.path);

      // Build candidate
      const firstFile = dirFiles[0]!;
      const dirHints = directoryHintsMap.get(firstFile.path) || { authorHint: null, seriesHint: null, titleHint: null, confidence: 0 };
      const fnHints = filenameHintsMap.get(firstFile.path) || { author: null, title: null, series: null, seriesPosition: null, trackNumber: null, confidence: 0 };

      // Parse sidecar metadata from the directory
      const sidecarMeta = parseSidecarMetadata(dir);

      // Resolve title/author
      const resolved = resolveMetadata(dirHints, fnHints, sidecarMeta, dirFiles.length > 1);

      candidates.push({
        files: dirFiles,
        directoryHints: dirHints,
        filenameHints: fnHints,
        sidecarMeta,
        resolvedTitle: resolved.title,
        resolvedAuthor: resolved.author,
        resolvedSeries: resolved.series,
        resolvedSeriesPosition: resolved.seriesPosition,
        resolvedSeriesList: resolved.seriesList,
        isAudiobook: true,
        coverSource: sidecarMeta?.coverPath ? 'sidecar' : null,
      });
    }
  }

  // --- C. Ebook duplicate format grouping ---
  // Group ebooks by normalized title in the same directory
  const ebookGroups = new Map<string, FileCandidate[]>();
  for (const file of ebookFiles) {
    if (consumed.has(file.path)) continue;
    const fnHints = filenameHintsMap.get(file.path);
    const title = fnHints?.title || file.filename.replace(/\.[^.]+$/, '');
    const key = `${file.directory}::${normalizeForComparison(title)}`;
    if (!ebookGroups.has(key)) ebookGroups.set(key, []);
    ebookGroups.get(key)!.push(file);
  }

  for (const [, groupFiles] of ebookGroups) {
    for (const f of groupFiles) consumed.add(f.path);

    const firstFile = groupFiles[0]!;
    const dirHints = directoryHintsMap.get(firstFile.path) || { authorHint: null, seriesHint: null, titleHint: null, confidence: 0 };
    const fnHints = filenameHintsMap.get(firstFile.path) || { author: null, title: null, series: null, seriesPosition: null, trackNumber: null, confidence: 0 };

    const sidecarMeta = parseSidecarMetadata(firstFile.directory);
    const resolved = resolveMetadata(dirHints, fnHints, sidecarMeta, false);

    candidates.push({
      files: groupFiles,
      directoryHints: dirHints,
      filenameHints: fnHints,
      sidecarMeta,
      resolvedTitle: resolved.title,
      resolvedAuthor: resolved.author,
      resolvedSeries: resolved.series,
      resolvedSeriesPosition: resolved.seriesPosition,
      resolvedSeriesList: resolved.seriesList,
      isAudiobook: false,
      coverSource: sidecarMeta?.coverPath ? 'sidecar' : null,
    });
  }

  return candidates;
}

// --- Pass 5: Candidate Resolution (Metadata merging) ---

interface ResolvedMeta {
  title: string;
  author: string | null;
  series: string | null;
  seriesPosition: number | null;
  seriesList: { name: string; position: number | null }[];
}

function resolveMetadata(
  dirHints: DirectoryHints,
  fnHints: FilenameHints,
  sidecar: SidecarMetadata | null,
  isMultiFileAudio: boolean,
): ResolvedMeta {
  // Title resolution by priority
  const titleCandidates: { value: string; confidence: number }[] = [];
  if (sidecar?.title) titleCandidates.push({ value: sidecar.title, confidence: 0.9 });
  if (dirHints.titleHint && isMultiFileAudio) titleCandidates.push({ value: dirHints.titleHint, confidence: 0.6 });
  if (fnHints.title) titleCandidates.push({ value: fnHints.title, confidence: 0.5 });
  if (dirHints.titleHint && !isMultiFileAudio) titleCandidates.push({ value: dirHints.titleHint, confidence: 0.3 });

  const title = titleCandidates.length > 0
    ? titleCandidates.sort((a, b) => b.confidence - a.confidence)[0]!.value
    : 'Unknown Title';

  // Author resolution by priority
  const authorCandidates: { value: string; confidence: number }[] = [];
  if (sidecar?.author) authorCandidates.push({ value: sidecar.author, confidence: 0.9 });
  if (dirHints.authorHint) authorCandidates.push({ value: dirHints.authorHint, confidence: 0.6 });
  if (fnHints.author) authorCandidates.push({ value: fnHints.author, confidence: 0.5 });

  const author = authorCandidates.length > 0
    ? authorCandidates.sort((a, b) => b.confidence - a.confidence)[0]!.value
    : null;

  // Series resolution
  const seriesCandidates: { value: string; confidence: number }[] = [];
  if (sidecar?.series) seriesCandidates.push({ value: sidecar.series, confidence: 0.9 });
  if (dirHints.seriesHint) seriesCandidates.push({ value: dirHints.seriesHint, confidence: 0.6 });
  if (fnHints.series) seriesCandidates.push({ value: fnHints.series, confidence: 0.5 });

  const series = seriesCandidates.length > 0
    ? seriesCandidates.sort((a, b) => b.confidence - a.confidence)[0]!.value
    : null;

  const seriesPosition = fnHints.seriesPosition ?? null;

  // Build full series list from sidecar or single resolved series
  const seriesList = sidecar?.seriesList && sidecar.seriesList.length > 0
    ? sidecar.seriesList
    : series ? [{ name: series, position: seriesPosition }] : [];

  return { title, author, series, seriesPosition, seriesList };
}

// --- Utilities ---

function normalizeForComparison(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

/**
 * Natural sort comparison — handles numeric prefixes like 001, 002.
 */
function naturalCompare(a: string, b: string): number {
  const regex = /(\d+)|(\D+)/g;
  const aParts = a.match(regex) || [];
  const bParts = b.match(regex) || [];

  for (let i = 0; i < Math.min(aParts.length, bParts.length); i++) {
    const aPart = aParts[i]!;
    const bPart = bParts[i]!;
    const aNum = parseInt(aPart);
    const bNum = parseInt(bPart);

    if (!isNaN(aNum) && !isNaN(bNum)) {
      if (aNum !== bNum) return aNum - bNum;
    } else {
      const cmp = aPart.localeCompare(bPart);
      if (cmp !== 0) return cmp;
    }
  }

  return aParts.length - bParts.length;
}

/**
 * Run the full scan pipeline. Returns BookCandidate[] ready for DB persistence.
 */
export function runPipeline(libraryPath: string): BookCandidate[] {
  // Pass 1: Discover files
  const files = discoverFiles(libraryPath);
  if (files.length === 0) return [];

  // Pass 2: Directory context for each file
  const directoryHintsMap = new Map<string, DirectoryHints>();
  for (const file of files) {
    directoryHintsMap.set(file.path, inferDirectoryContext(file, libraryPath));
  }

  // Pass 3: Filename parsing for each file
  const filenameHintsMap = new Map<string, FilenameHints>();
  for (const file of files) {
    filenameHintsMap.set(file.path, parseFilenameEnhanced(file));
  }

  // Pass 4: Group into book candidates
  const candidates = groupIntoCandidates(files, directoryHintsMap, filenameHintsMap, libraryPath);

  // Pass 5: Cross-format merge (ebook + audiobook → single candidate)
  const merged = mergeCrossFormat(candidates);

  return merged;
}

/**
 * Pass 5: Merge ebook and audiobook candidates that share the same normalized title.
 * This combines e.g. an epub and an m4b of the same book into a single BookCandidate.
 */
function mergeCrossFormat(candidates: BookCandidate[]): BookCandidate[] {
  const audioCandidates = candidates.filter(c => c.isAudiobook);
  const ebookCandidates = candidates.filter(c => !c.isAudiobook);
  const merged: BookCandidate[] = [];
  const consumedEbooks = new Set<number>();

  for (const audio of audioCandidates) {
    const matchIdx = ebookCandidates.findIndex((eb, i) =>
      !consumedEbooks.has(i) &&
      normalizeForComparison(audio.resolvedTitle) === normalizeForComparison(eb.resolvedTitle),
    );
    if (matchIdx >= 0) {
      consumedEbooks.add(matchIdx);
      const ebook = ebookCandidates[matchIdx]!;
      // Merge ebook files into the audio candidate
      audio.files.push(...ebook.files);
      // Prefer sidecar/embedded metadata from either source
      if (!audio.sidecarMeta && ebook.sidecarMeta) audio.sidecarMeta = ebook.sidecarMeta;
      if (!audio.resolvedAuthor && ebook.resolvedAuthor) audio.resolvedAuthor = ebook.resolvedAuthor;
    }
    merged.push(audio);
  }

  // Add remaining unmerged ebooks
  for (let i = 0; i < ebookCandidates.length; i++) {
    if (!consumedEbooks.has(i)) merged.push(ebookCandidates[i]!);
  }
  return merged;
}
