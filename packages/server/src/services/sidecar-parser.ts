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
      // Only fill in fields not already set by OPF
      if (!result.title && jsonResult.title) result.title = jsonResult.title;
      if (!result.author && jsonResult.author) result.author = jsonResult.author;
      if (!result.narrator && jsonResult.narrator) result.narrator = jsonResult.narrator;
      if (!result.series && jsonResult.series) result.series = jsonResult.series;
      if (jsonResult.seriesList && jsonResult.seriesList.length > 0 && result.seriesList.length === 0) result.seriesList = jsonResult.seriesList;
      if (jsonResult.tags && jsonResult.tags.length > 0 && result.tags.length === 0) result.tags = jsonResult.tags;
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
    if (titleMatch) result.title = titleMatch[1]!.trim();

    // dc:creator (author)
    const creatorMatch = content.match(/<dc:creator[^>]*>([^<]+)<\/dc:creator>/i);
    if (creatorMatch) result.author = creatorMatch[1]!.trim();

    // narrator — various conventions
    const narratorMatch = content.match(
      /<meta\s+name=["'](?:lazylibrarian:narrator|narrator|calibre:narrator)["']\s+content=["']([^"']+)["']/i,
    );
    if (narratorMatch) result.narrator = narratorMatch[1]!.trim();

    // dc:subject (tags)
    const subjectRegex = /<dc:subject[^>]*>([^<]+)<\/dc:subject>/gi;
    let subjectMatch;
    while ((subjectMatch = subjectRegex.exec(content)) !== null) {
      result.tags!.push(subjectMatch[1]!.trim());
    }

    // Series — calibre convention
    const seriesMatch = content.match(
      /<meta\s+name=["']calibre:series["']\s+content=["']([^"']+)["']/i,
    );
    if (seriesMatch) result.series = seriesMatch[1]!.trim();

    return result;
  } catch {
    return null;
  }
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
      if (Array.isArray(data.series)) {
        const parsed = data.series.map((s: string) => {
          const match = String(s).match(/^(.+?)\s*#(\d+(?:\.\d+)?)$/);
          if (match) return { name: match[1]!.trim(), position: parseFloat(match[2]!) };
          return { name: String(s).trim(), position: null };
        });
        result.seriesList = parsed;
        result.series = parsed[0]?.name || null;
      } else {
        const seriesStr = String(data.series);
        const match = seriesStr.match(/^(.+?)\s*#(\d+(?:\.\d+)?)$/);
        if (match) {
          result.seriesList = [{ name: match[1]!.trim(), position: parseFloat(match[2]!) }];
          result.series = match[1]!.trim();
        } else {
          result.seriesList = [{ name: seriesStr, position: null }];
          result.series = seriesStr;
        }
      }
    }
    if (data.tags && Array.isArray(data.tags)) result.tags = data.tags.map(String);

    return result;
  } catch {
    return null;
  }
}
