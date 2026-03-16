/**
 * Sanitize HTML from book descriptions (Hardcover API, EPUB metadata, etc.)
 * Strips tags, decodes entities, normalizes whitespace.
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

export function sanitizeDescription(raw: string | null | undefined): string | null {
  if (!raw || !raw.trim()) return null;

  let text = raw;

  // Convert block-level tags to newlines before stripping
  text = text.replaceAll(/<\s*\/?\s*(p|br|div|li|h[1-6]|blockquote)\b[^>]*\/?>/gi, '\n');

  // Strip all remaining HTML tags
  text = text.replaceAll(/<[^>]+>/g, '');

  // Decode named & numeric HTML entities
  text = text.replaceAll(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (entity) => {
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

  // Normalize whitespace: collapse runs of spaces/tabs within lines
  text = text.replaceAll(/[^\S\n]+/g, ' ');

  // Collapse 3+ consecutive newlines into 2
  text = text.replaceAll(/\n{3,}/g, '\n\n');

  // Trim each line and the whole string
  text = text
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();

  return text || null;
}
