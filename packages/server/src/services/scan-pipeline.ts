import fs from 'node:fs';
import path from 'node:path';
import { SUPPORTED_FORMATS, SUPPORTED_AUDIO_FORMATS } from '@npc-shelf/shared';
import { parseFilenameEnhanced, cleanTitle, type FilenameHints } from '../utils/filename-parser.js';
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
  const extensions = new Set(SUPPORTED_FORMATS.map((f) => `.${f}`));
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
        if (extensions.has(ext)) {
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
    result.authorHint = segments[0];
  } else if (segments.length === 2) {
    // e.g., Author/Book/file.m4b
    result.authorHint = segments[0];
    result.titleHint = segments[1];
  } else {
    // e.g., Author/Series/Book/file.m4b
    result.authorHint = segments[0];
    result.seriesHint = segments[1];
    result.titleHint = segments[2];
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

function buildCandidate(
  files: FileCandidate[],
  directoryHintsMap: Map<string, DirectoryHints>,
  filenameHintsMap: Map<string, FilenameHints>,
  sidecarDir: string,
  isMultiFileAudio: boolean,
  isAudiobook: boolean,
): BookCandidate {
  const firstFile = files[0];
  const dirHints = directoryHintsMap.get(firstFile.path) || { authorHint: null, seriesHint: null, titleHint: null, confidence: 0 };
  const fnHints = filenameHintsMap.get(firstFile.path) || { author: null, title: null, series: null, seriesPosition: null, trackNumber: null, confidence: 0 };
  const sidecarMeta = parseSidecarMetadata(sidecarDir);
  const resolved = resolveMetadata(dirHints, fnHints, sidecarMeta, isMultiFileAudio);

  return {
    files,
    directoryHints: dirHints,
    filenameHints: fnHints,
    sidecarMeta,
    resolvedTitle: resolved.title,
    resolvedAuthor: resolved.author,
    resolvedSeries: resolved.series,
    resolvedSeriesPosition: resolved.seriesPosition,
    resolvedSeriesList: resolved.seriesList,
    isAudiobook,
    coverSource: sidecarMeta?.coverPath ? 'sidecar' : null,
  };
}

function groupAudioFiles(
  audioFiles: FileCandidate[],
  consumed: Set<string>,
  directoryHintsMap: Map<string, DirectoryHints>,
  filenameHintsMap: Map<string, FilenameHints>,
): BookCandidate[] {
  const candidates: BookCandidate[] = [];
  const audioDirMap = new Map<string, FileCandidate[]>();

  for (const file of audioFiles) {
    let list = audioDirMap.get(file.directory);
    if (!list) {
      list = [];
      audioDirMap.set(file.directory, list);
    }
    list.push(file);
  }

  for (const [dir, dirFiles] of audioDirMap) {
    if (dirFiles.length < 1) continue;
    dirFiles.sort((a, b) => naturalCompare(a.filename, b.filename));
    for (const f of dirFiles) consumed.add(f.path);
    candidates.push(buildCandidate(dirFiles, directoryHintsMap, filenameHintsMap, dir, dirFiles.length > 1, true));
  }

  return candidates;
}

function groupEbookFiles(
  ebookFiles: FileCandidate[],
  consumed: Set<string>,
  directoryHintsMap: Map<string, DirectoryHints>,
  filenameHintsMap: Map<string, FilenameHints>,
): BookCandidate[] {
  const candidates: BookCandidate[] = [];
  const ebookGroups = new Map<string, FileCandidate[]>();

  for (const file of ebookFiles) {
    if (consumed.has(file.path)) continue;
    const fnHints = filenameHintsMap.get(file.path);
    const title = fnHints?.title || file.filename.replace(/\.[^.]+$/, '');
    const key = `${file.directory}::${normalizeForComparison(title)}`;
    let list = ebookGroups.get(key);
    if (!list) {
      list = [];
      ebookGroups.set(key, list);
    }
    list.push(file);
  }

  for (const [, groupFiles] of ebookGroups) {
    for (const f of groupFiles) consumed.add(f.path);
    candidates.push(buildCandidate(groupFiles, directoryHintsMap, filenameHintsMap, groupFiles[0].directory, false, false));
  }

  return candidates;
}

export function groupIntoCandidates(
  files: FileCandidate[],
  directoryHintsMap: Map<string, DirectoryHints>,
  filenameHintsMap: Map<string, FilenameHints>,
  _libraryRoot: string,
): BookCandidate[] {
  const consumed = new Set<string>();
  const audioFiles = files.filter((f) => f.isAudio);
  const ebookFiles = files.filter((f) => !f.isAudio);

  const audioCandidates = groupAudioFiles(audioFiles, consumed, directoryHintsMap, filenameHintsMap);
  const ebookCandidates = groupEbookFiles(ebookFiles, consumed, directoryHintsMap, filenameHintsMap);

  return [...audioCandidates, ...ebookCandidates];
}

// --- Pass 5: Candidate Resolution (Metadata merging) ---

interface ResolvedMeta {
  title: string;
  author: string | null;
  series: string | null;
  seriesPosition: number | null;
  seriesList: { name: string; position: number | null }[];
}

function resolveBestCandidate(sources: { value: string; confidence: number }[]): string | null {
  if (sources.length === 0) return null;
  sources.sort((a, b) => b.confidence - a.confidence);
  return sources[0].value;
}

function resolveSeriesList(
  sidecar: SidecarMetadata | null,
  series: string | null,
  seriesPosition: number | null,
): { name: string; position: number | null }[] {
  if (sidecar?.seriesList && sidecar.seriesList.length > 0) {
    return sidecar.seriesList;
  }
  if (series) {
    return [{ name: series, position: seriesPosition }];
  }
  return [];
}

function resolveMetadata(
  dirHints: DirectoryHints,
  fnHints: FilenameHints,
  sidecar: SidecarMetadata | null,
  isMultiFileAudio: boolean,
): ResolvedMeta {
  const titleSources: { value: string; confidence: number }[] = [];
  if (sidecar?.title) titleSources.push({ value: sidecar.title, confidence: 0.9 });
  if (dirHints.titleHint && isMultiFileAudio) titleSources.push({ value: dirHints.titleHint, confidence: 0.6 });
  if (fnHints.title) titleSources.push({ value: fnHints.title, confidence: 0.5 });
  if (dirHints.titleHint && !isMultiFileAudio) titleSources.push({ value: dirHints.titleHint, confidence: 0.3 });
  const title = cleanTitle(resolveBestCandidate(titleSources) ?? 'Unknown Title');

  const authorSources: { value: string; confidence: number }[] = [];
  if (sidecar?.author) authorSources.push({ value: sidecar.author, confidence: 0.9 });
  if (dirHints.authorHint) authorSources.push({ value: dirHints.authorHint, confidence: 0.6 });
  if (fnHints.author) authorSources.push({ value: fnHints.author, confidence: 0.5 });
  const author = resolveBestCandidate(authorSources);

  const seriesSources: { value: string; confidence: number }[] = [];
  if (sidecar?.series) seriesSources.push({ value: sidecar.series, confidence: 0.9 });
  if (dirHints.seriesHint) seriesSources.push({ value: dirHints.seriesHint, confidence: 0.6 });
  if (fnHints.series) seriesSources.push({ value: fnHints.series, confidence: 0.5 });
  const series = resolveBestCandidate(seriesSources);

  const seriesPosition = fnHints.seriesPosition ?? null;
  const seriesList = resolveSeriesList(sidecar, series, seriesPosition);

  return { title, author, series, seriesPosition, seriesList };
}

// --- Utilities ---

function normalizeForComparison(title: string): string {
  return title
    .toLowerCase()
    .replaceAll(/[^a-z0-9]/g, '')
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
    const aPart = aParts[i];
    const bPart = bParts[i];
    const aNum = Number.parseInt(aPart);
    const bNum = Number.parseInt(bPart);

    if (!Number.isNaN(aNum) && !Number.isNaN(bNum)) {
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
 * Optionally accepts pre-discovered files to avoid a second filesystem walk.
 */
export function runPipeline(libraryPath: string, preDiscoveredFiles?: FileCandidate[]): BookCandidate[] {
  // Pass 1: Discover files (or reuse pre-discovered)
  const files = preDiscoveredFiles ?? discoverFiles(libraryPath);
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
      const ebook = ebookCandidates[matchIdx];
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
    if (!consumedEbooks.has(i)) merged.push(ebookCandidates[i]);
  }
  return merged;
}
