/**
 * Extract title and author from common filename patterns.
 * Patterns supported:
 *   "Author - Title"
 *   "Title - Author"
 *   "Title (Year)"
 *   "Author/Title/file.epub"
 */
export interface ParsedFilename {
  title: string;
  author: string | null;
  year: string | null;
  seriesName: string | null;
  seriesPosition: number | null;
}

const SERIES_PATTERN = /\(([^)]+)\s+#?(\d+(?:\.\d+)?)\)/;
const YEAR_PATTERN = /\((\d{4})\)/;
const AUTHOR_TITLE_DASH = /^([^-]+?)\s*-\s*(.+)$/;

export function parseFilename(filename: string, dirPath?: string): ParsedFilename {
  // Remove extension
  const name = filename.replace(/\.[^.]+$/, '').trim();

  let title = name;
  let author: string | null = null;
  let year: string | null = null;
  let seriesName: string | null = null;
  let seriesPosition: number | null = null;

  // Extract series info: "Title (Series #2)"
  const seriesMatch = name.match(SERIES_PATTERN);
  if (seriesMatch) {
    seriesName = seriesMatch[1].trim();
    seriesPosition = parseFloat(seriesMatch[2]);
    title = name.replace(SERIES_PATTERN, '').trim();
  }

  // Extract year: "Title (2023)"
  const yearMatch = title.match(YEAR_PATTERN);
  if (yearMatch) {
    year = yearMatch[1];
    title = title.replace(YEAR_PATTERN, '').trim();
  }

  // "Author - Title" pattern
  const dashMatch = title.match(AUTHOR_TITLE_DASH);
  if (dashMatch) {
    author = dashMatch[1].trim();
    title = dashMatch[2].trim();
  }

  // Fall back to directory name for author
  if (!author && dirPath) {
    const parts = dirPath.split(/[/\\]/).filter(Boolean);
    if (parts.length >= 2) {
      // Assume parent dir is author: Author/BookTitle/file.epub
      author = parts[parts.length - 2];
    }
  }

  // Clean up underscores and extra whitespace
  title = title.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  if (author) author = author.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();

  return { title, author, year, seriesName, seriesPosition };
}

/**
 * Generate sort name from author name: "First Last" -> "Last, First"
 */
export function toSortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length <= 1) return name;
  const last = parts.pop()!;
  return `${last}, ${parts.join(' ')}`;
}

// --- Enhanced filename parsing for scan pipeline ---

export interface FilenameHints {
  author: string | null;
  title: string | null;
  series: string | null;
  seriesPosition: number | null;
  trackNumber: number | null;
  confidence: number;
}

const TRACK_NUMBER_PATTERN = /^(\d+)\s*[-_.]\s*/;

/**
 * Enhanced filename parsing that also detects track numbers.
 * Accepts a FileCandidate-shaped object with filename and extension.
 */
export function parseFilenameEnhanced(file: { filename: string; extension: string }): FilenameHints {
  let name = file.filename.replace(/\.[^.]+$/, '').trim();
  let trackNumber: number | null = null;

  // Detect leading track numbers: "001 - Title.m4b"
  const trackMatch = name.match(TRACK_NUMBER_PATTERN);
  if (trackMatch) {
    trackNumber = parseInt(trackMatch[1]!, 10);
    name = name.slice(trackMatch[0].length).trim();
  }

  // Use the existing parser on the cleaned name
  const parsed = parseFilename(name + '.' + file.extension);

  let confidence = 0.5;
  if (parsed.author) confidence += 0.2;
  if (parsed.seriesName) confidence += 0.1;

  return {
    author: parsed.author,
    title: parsed.title,
    series: parsed.seriesName,
    seriesPosition: parsed.seriesPosition,
    trackNumber,
    confidence,
  };
}
