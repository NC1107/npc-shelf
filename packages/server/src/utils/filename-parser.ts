/**
 * Extract title and author from common filename patterns.
 * Patterns supported:
 *   "Author - Title"
 *   "Title - Author"
 *   "Title (Year)"
 *   "Title (Series Book 4) - Author"
 *   "Author/Title/file.epub"
 */
export interface ParsedFilename {
  title: string;
  author: string | null;
  year: string | null;
  seriesName: string | null;
  seriesPosition: number | null;
}

const SERIES_PATTERN = /\(([^)]{1,200})\s+(?:Book|#)\s*(\d{1,5}(?:\.\d{1,3})?)\)/;
const SERIES_PATTERN_LEGACY = /\(([^)]{1,200})\s+#?(\d{1,5}(?:\.\d{1,3})?)\)/;
const YEAR_PATTERN = /\((\d{4})\)/;
const AUTHOR_TITLE_DASH = /^(.{1,500}?)\s+-\s+(.+)$/;

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

export function getDirAuthorHint(dirPath?: string): string | null {
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

/**
 * Normalize a raw filename into a clean string for parsing.
 * Stage 2 of the detection pipeline — separate from parsing (Stage 3).
 */
export function normalizeFilename(raw: string): string {
  let name = raw;
  // 1. Strip extension
  name = name.replace(/\.[^.]+$/, '').trim();
  // 2. Dot-to-space (3+ dots, no spaces) + bare hyphen normalization
  if (!name.includes(' ') && (name.match(/\./g) || []).length >= 3) {
    name = name.replace(/\./g, ' ');
    name = name.replace(/(\w)-(\w)/g, '$1 - $2');
  }
  // 3. Strip release tags: [EPUB], (ARAR), scene tags
  name = name.replace(/\s*\[[^\]]{0,200}\]/g, '');
  // 5. Unicode NFKC normalization
  name = name.normalize('NFKC');
  // 6. Normalize punctuation: smart quotes→regular, em-dash→hyphen
  name = name.replace(/[\u2013\u2014]/g, '-').replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"');
  // 7. Collapse whitespace
  name = name.replaceAll(/\s+/g, ' ').trim();
  return name;
}

export function parseFilename(filename: string, dirPath?: string): ParsedFilename {
  const name = normalizeFilename(filename);

  let title = name;
  let author: string | null = null;
  let year: string | null = null;
  let seriesName: string | null = null;
  let seriesPosition: number | null = null;

  // Extract series info: "Title (Series Book 4)" or "Title (Series #2)"
  const seriesMatch = SERIES_PATTERN.exec(name) || SERIES_PATTERN_LEGACY.exec(name);
  if (seriesMatch) {
    seriesName = seriesMatch[1].trim();
    seriesPosition = Number.parseFloat(seriesMatch[2]);
    title = name.replace(seriesMatch[0], '').trim();
  }

  // Extract year: "Title (2023)"
  const yearMatch = YEAR_PATTERN.exec(title);
  if (yearMatch) {
    year = yearMatch[1];
    title = title.replace(YEAR_PATTERN, '').trim();
  }

  // "Author - Title" or "Title - Author" pattern
  const dashMatch = AUTHOR_TITLE_DASH.exec(title);
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
  title = title.replaceAll('_', ' ').replaceAll(/\s+/g, ' ').trim();
  if (author) author = author.replaceAll('_', ' ').replaceAll(/\s+/g, ' ').trim();

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

/**
 * Clean common filename artifacts from a title string.
 */
export function cleanTitle(title: string): string {
  let cleaned = title;
  // Strip format suffixes: (azw3), (epub), (mobi), (pdf), (m4b), (mp3)
  cleaned = cleaned.replace(/\s*\((?:azw3|epub|mobi|pdf|m4b|mp3)\)\s*$/i, '');
  // Strip (retail), (US), (UK), version tags like (v5.0)
  cleaned = cleaned.replace(/\s*\((?:retail|US|UK|v\d+(?:\.\d+)?)\)\s*/gi, '');
  // Strip [Series NN] - prefix
  cleaned = cleaned.replace(/^\[[^\]]{0,200}\]\s*-\s*/, '');
  // Strip year prefix like (1941)
  cleaned = cleaned.replace(/^\(\d{4}\)\s*/, '');
  // Strip scene group tags: eBook-XXX at end
  cleaned = cleaned.replace(/\s+eBook-\w+$/i, '');
  // Strip standalone format/release words (not in parens)
  cleaned = cleaned.replace(/\b(?:RETAIL|EPUB|AZW3|MOBI|PDF)\b/gi, '');
  // Collapse whitespace
  cleaned = cleaned.replace(/\s{2,}/g, ' ').trim();
  // Strip leading/trailing dashes and whitespace
  cleaned = cleaned.replace(/^[\s-]+/, '').replace(/[\s-]+$/, '').trim();
  return cleaned || title;
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
  // Strip extension first, extract brackets BEFORE normalizeFilename strips them
  let raw = file.filename.replace(/\.[^.]+$/, '').trim();
  let trackNumber: number | null = null;
  let bracketSeries: string | null = null;
  let bracketPosition: number | null = null;

  // Detect leading track numbers: "001 - Title.m4b"
  const trackMatch = TRACK_NUMBER_PATTERN.exec(raw);
  if (trackMatch) {
    trackNumber = Number.parseInt(trackMatch[1], 10);
    raw = raw.slice(trackMatch[0].length).trim();
  }

  // Extract [Series NN] - prefix before normalization strips brackets
  const bracketMatch = /^\[([^\]]{1,200})\s+(\d{1,5}(?:\.\d{1,3})?)\]\s*-\s*(.+)/.exec(raw);
  if (bracketMatch) {
    bracketSeries = bracketMatch[1];
    bracketPosition = Number.parseFloat(bracketMatch[2]);
    raw = bracketMatch[3];
  }

  // Now normalize the remaining string
  let name = normalizeFilename(raw + '.' + file.extension);

  // Clean filename artifacts before parsing
  name = cleanTitle(name);

  // Use the existing parser on the cleaned name
  const parsed = parseFilename(name + '.' + file.extension);

  let confidence = 0.5;
  if (parsed.author) confidence += 0.2;
  if (parsed.seriesName || bracketSeries) confidence += 0.1;

  return {
    author: parsed.author,
    title: cleanTitle(parsed.title),
    series: parsed.seriesName || bracketSeries,
    seriesPosition: parsed.seriesPosition ?? bracketPosition,
    trackNumber,
    confidence,
  };
}
