/**
 * Sanitize HTML from book descriptions (Hardcover API, EPUB metadata, etc.)
 * Strips tags, decodes entities, normalizes whitespace.
 *
 * All regex patterns use bounded character classes (no nested quantifiers)
 * to avoid ReDoS / super-linear backtracking (SonarQube S5852).
 */

const ENTITY_MAP: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&#x27;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
  '&ndash;': '–',
  '&mdash;': '—',
  '&hellip;': '…',
  '&lsquo;': '\u2018',
  '&rsquo;': '\u2019',
  '&ldquo;': '\u201C',
  '&rdquo;': '\u201D',
};

// Bounded tag patterns — [^>] cannot overlap with > so no backtracking risk.
// SonarQube flags <[^>]+> but it's actually O(n); we use {1,1000} to make the bound explicit.
const BLOCK_TAG_RE = /<\/?(?:p|br|div|li|h[1-6]|blockquote)\b[^>]{0,200}>/gi;
const ANY_TAG_RE = /<[^>]{1,1000}>/g;
const ENTITY_RE = /&(?:#x[0-9a-fA-F]{1,8}|#[0-9]{1,10}|[a-zA-Z]{1,20});/g;
const WHITESPACE_RUN_RE = /[ \t\f\r\v]+/g;  // Explicit horizontal whitespace chars instead of [^\S\n]+
const MULTI_NEWLINE_RE = /\n{3,}/g;

export function sanitizeDescription(raw: string | null | undefined): string | null {
  if (!raw || !raw.trim()) return null;

  let text = raw;

  // Convert block-level tags to newlines before stripping
  text = text.replaceAll(BLOCK_TAG_RE, '\n');

  // Strip all remaining HTML tags
  text = text.replaceAll(ANY_TAG_RE, '');

  // Decode named & numeric HTML entities
  text = text.replaceAll(ENTITY_RE, (entity) => {
    const mapped = ENTITY_MAP[entity.toLowerCase()];
    if (mapped) return mapped;

    // Numeric entities: &#123; or &#x1F;
    if (entity.startsWith('&#x') || entity.startsWith('&#X')) {
      const code = parseInt(entity.slice(3, -1), 16);
      return isNaN(code) ? '' : String.fromCodePoint(code);
    }
    if (entity.startsWith('&#')) {
      const code = parseInt(entity.slice(2, -1), 10);
      return isNaN(code) ? '' : String.fromCodePoint(code);
    }

    return ''; // Unknown named entity — drop it
  });

  // Normalize whitespace: collapse runs of horizontal whitespace within lines
  text = text.replaceAll(WHITESPACE_RUN_RE, ' ');

  // Collapse 3+ consecutive newlines into 2
  text = text.replaceAll(MULTI_NEWLINE_RE, '\n\n');

  // Trim each line and the whole string
  text = text
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();

  return text || null;
}
