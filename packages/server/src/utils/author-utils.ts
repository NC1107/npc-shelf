/**
 * Normalize an author name for consistent storage and matching.
 * - Strips extra periods from initials: "J.R.R." → "J. R. R."
 * - Flips "Last, First" to "First Last" when appropriate
 * - Trims and collapses whitespace
 */
export function normalizeAuthorName(name: string): string {
  let n = name.trim();
  if (!n) return n;

  // Handle "Last, First" format — flip if comma-separated with exactly 2 parts
  // and the first part looks like a single surname (one word)
  const commaParts = n.split(',').map((p) => p.trim());
  if (commaParts.length === 2 && commaParts[0] && commaParts[1]) {
    const lastName = commaParts[0];
    const firstName = commaParts[1];
    // Only flip if the last-name part is a single word (no spaces except initials)
    const lastNameWords = lastName.split(/\s+/).filter(Boolean);
    if (lastNameWords.length === 1) {
      n = `${firstName} ${lastName}`;
    }
  }

  // Normalize initials: "J.R.R." → "J. R. R.", "J.R.R" → "J. R. R."
  // Match sequences of letter-dot without spaces between them
  n = n.replace(/\b([A-Z])\.(?=[A-Z])/g, '$1. ');

  // Collapse whitespace
  n = n.replace(/\s+/g, ' ').trim();

  return n;
}

/**
 * Check if a string looks like a person name (2+ words).
 */
function looksLikePersonName(s: string): boolean {
  const words = s.trim().split(/\s+/);
  return words.length >= 2;
}

/**
 * Split a multi-author string into individual author names.
 * Splits on " & ", " and ", " / ".
 * Only splits on ", " when BOTH sides pass looksLikePersonName().
 */
export function splitMultiAuthor(name: string): string[] {
  let parts = [name.trim()];

  // Split on " & "
  parts = parts.flatMap((p) => p.split(/\s+&\s+/));

  // Split on " and " (case insensitive, word boundary)
  parts = parts.flatMap((p) => p.split(/\s+and\s+/i));

  // Split on " / "
  parts = parts.flatMap((p) => p.split(/\s*\/\s*/));

  // Split on ", " only when both sides look like person names
  const expanded: string[] = [];
  for (const part of parts) {
    if (part.includes(',')) {
      const commaParts = part.split(/,\s*/);
      // Try comma split: only if all parts look like person names
      if (commaParts.length >= 2 && commaParts.every(looksLikePersonName)) {
        expanded.push(...commaParts);
      } else {
        expanded.push(part);
      }
    } else {
      expanded.push(part);
    }
  }

  return expanded.map((p) => p.trim()).filter(Boolean);
}
