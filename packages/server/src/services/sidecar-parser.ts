import fs from 'node:fs';
import path from 'node:path';

export interface SidecarMetadata {
  title: string | null;
  author: string | null;
  narrator: string | null;
  series: string | null;
  seriesList: { name: string; position: number | null }[];
  tags: string[];
  coverPath: string | null;
}

/**
 * Parse sidecar metadata files (.opf, metadata.json, cover images) from a directory.
 */
export function parseSidecarMetadata(directoryPath: string): SidecarMetadata | null {
  let entries: string[];
  try {
    entries = fs.readdirSync(directoryPath);
  } catch {
    return null;
  }

  let result: SidecarMetadata = {
    title: null,
    author: null,
    narrator: null,
    series: null,
    seriesList: [],
    tags: [],
    coverPath: null,
  };

  let found = false;

  // Check for .opf file
  const opfFile = entries.find((e) => e.toLowerCase().endsWith('.opf'));
  if (opfFile) {
    const opfResult = parseOpfFile(path.join(directoryPath, opfFile));
    if (opfResult) {
      result = { ...result, ...opfResult };
      found = true;
    }
  }

  // Check for metadata.json
  const metaJson = entries.find((e) => e.toLowerCase() === 'metadata.json');
  if (metaJson) {
    const jsonResult = parseMetadataJson(path.join(directoryPath, metaJson));
    if (jsonResult) {
      mergeSidecarFields(result, jsonResult);
      found = true;
    }
  }

  // Check for cover image
  const coverFile = entries.find((e) => {
    const lower = e.toLowerCase();
    return lower === 'cover.jpg' || lower === 'cover.jpeg' || lower === 'cover.png' || lower === 'folder.jpg';
  });
  if (coverFile) {
    result.coverPath = path.join(directoryPath, coverFile);
    found = true;
  }

  return found ? result : null;
}

function mergeSidecarFields(target: SidecarMetadata, source: Partial<SidecarMetadata>): void {
  if (!target.title && source.title) target.title = source.title;
  if (!target.author && source.author) target.author = source.author;
  if (!target.narrator && source.narrator) target.narrator = source.narrator;
  if (!target.series && source.series) target.series = source.series;
  if (source.seriesList && source.seriesList.length > 0 && target.seriesList.length === 0) target.seriesList = source.seriesList;
  if (source.tags && source.tags.length > 0 && target.tags.length === 0) target.tags = source.tags;
}

/**
 * Parse an OPF (Open Packaging Format) file for metadata.
 * Uses simple regex — OPF is straightforward XML.
 */
function parseOpfFile(filePath: string): Partial<SidecarMetadata> | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const result: Partial<SidecarMetadata> = { tags: [] };

    // dc:title
    const titleMatch = content.match(/<dc:title[^>]*>([^<]+)<\/dc:title>/i);
    if (titleMatch) result.title = titleMatch[1].trim();

    // dc:creator (author)
    const creatorMatch = content.match(/<dc:creator[^>]{0,200}>([^<]+)<\/dc:creator>/i);
    if (creatorMatch) result.author = creatorMatch[1].trim();

    // narrator — various conventions
    const narratorMatch = content.match(
      /<meta\s{1,10}name=["'](?:lazylibrarian:narrator|narrator|calibre:narrator)["']\s{1,10}content=["']([^"']{1,500})["']/i,
    );
    if (narratorMatch) result.narrator = narratorMatch[1].trim();

    // dc:subject (tags)
    const subjectRegex = /<dc:subject[^>]{0,200}>([^<]+)<\/dc:subject>/gi;
    let subjectMatch;
    while ((subjectMatch = subjectRegex.exec(content)) !== null) {
      (result.tags ??= []).push(subjectMatch[1].trim());
    }

    // Series — calibre convention
    const seriesMatch = content.match(
      /<meta\s{1,10}name=["']calibre:series["']\s{1,10}content=["']([^"']{1,500})["']/i,
    );
    if (seriesMatch) result.series = seriesMatch[1].trim();

    return result;
  } catch {
    return null;
  }
}

function parseSeriesEntry(s: string): { name: string; position: number | null } {
  const match = /^(.{1,500}?)\s*#(\d{1,5}(?:\.\d{1,3})?)$/.exec(String(s));
  if (match) return { name: match[1].trim(), position: Number.parseFloat(match[2]) };
  return { name: String(s).trim(), position: null };
}

function parseSeriesField(series: unknown): { seriesList: { name: string; position: number | null }[]; series: string | null } {
  if (Array.isArray(series)) {
    const parsed = series.map((s: string) => parseSeriesEntry(s));
    return { seriesList: parsed, series: parsed[0]?.name || null };
  }
  const entry = parseSeriesEntry(String(series));
  return { seriesList: [entry], series: entry.name };
}

/**
 * Parse a metadata.json file (Audiobookshelf / Abs format).
 */
function parseMetadataJson(filePath: string): Partial<SidecarMetadata> | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content);

    const result: Partial<SidecarMetadata> = { tags: [] };

    // Support various shapes
    if (data.title) result.title = String(data.title);
    if (data.author) result.author = String(data.author);
    if (data.authors) result.author = Array.isArray(data.authors) ? data.authors.join(', ') : String(data.authors);
    if (data.narrator) result.narrator = String(data.narrator);
    if (data.narrators) result.narrator = Array.isArray(data.narrators) ? data.narrators.join(', ') : String(data.narrators);
    if (data.series) {
      const { seriesList, series } = parseSeriesField(data.series);
      result.seriesList = seriesList;
      result.series = series;
    }
    if (data.tags && Array.isArray(data.tags)) result.tags = data.tags.map(String);

    return result;
  } catch {
    return null;
  }
}
