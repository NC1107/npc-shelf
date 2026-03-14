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
const AUTHOR_TITLE_DASH = /^(.+?)\s+-\s+(.+)$/;

function looksLikePersonName(name: string): boolean {
  // Person names: have spaces, no digits, no underscores/colons/special chars, 2-4 words
  const words = name.trim().split(/\s+/);
  return (
    words.length >= 2 &&
    words.length <= 4 &&
    !/\d/.test(name) &&
    !/[_:;!?#@$%^&*()[\]{}|<>~]/.test(name) &&
    name.length < 50
  );
}

function normalizeForMatch(s: string): string {
  return s.toLowerCase().replaceAll(/[^a-z0-9]/g, '');
}

function getDirAuthorHint(dirPath?: string): string | null {
  if (!dirPath) return null;
  const parts = dirPath.split(/[/\\]/).filter(Boolean);
  return parts.length >= 2 ? (parts.at(-2) ?? null) : null;
}

/** Disambiguate left/right sides of a dash-separated filename. */
function resolveAuthorTitle(
  left: string,
  right: string,
  dirPath?: string,
): { author: string; title: string } {
  const rightIsPerson = looksLikePersonName(right);
  const leftIsPerson = looksLikePersonName(left);
  const dirHint = getDirAuthorHint(dirPath);

  if (dirHint) {
    const rightMatchesDir = normalizeForMatch(right) === normalizeForMatch(dirHint);
    const leftMatchesDir = normalizeForMatch(left) === normalizeForMatch(dirHint);
    if (rightMatchesDir && !leftMatchesDir) {
      return { author: right, title: left };
    }
  } else if (rightIsPerson && !leftIsPerson) {
    return { author: right, title: left };
  }

  return { author: left, title: right };
}

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

  // "Author - Title" or "Title - Author" pattern
  const dashMatch = title.match(AUTHOR_TITLE_DASH);
  if (dashMatch) {
    const resolved = resolveAuthorTitle(dashMatch[1].trim(), dashMatch[2].trim(), dirPath);
    author = resolved.author;
    title = resolved.title;
  }

  // Fall back to directory name for author
  if (!author && dirPath) {
    const dirHint = getDirAuthorHint(dirPath);
    if (dirHint) author = dirHint;
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
