/**
 * Compute similarity between two strings.
 * Dispatches to Jaro-Winkler for short strings (<8 chars normalized),
 * otherwise takes max(bigramJaccard, tokenSortRatio).
 * Returns a value between 0 (no match) and 1 (exact match).
 */
export function stringSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;

  const s1 = normalizeForComparison(a);
  const s2 = normalizeForComparison(b);
  if (s1 === s2) return 1;
  if (!s1 || !s2) return 0;

  const shorter = s1.length < s2.length ? s1 : s2;

  // Short strings: Jaro-Winkler handles them much better than bigrams
  if (shorter.length < 8) {
    return jaroWinkler(s1, s2);
  }

  // Longer strings: take the better of bigram Jaccard and token sort ratio
  return Math.max(bigramJaccard(s1, s2), tokenSortRatio(s1, s2));
}

/**
 * Jaro-Winkler similarity — excellent for short strings.
 * Measures prefix similarity + transposition tolerance.
 */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;

  const s1 = a.length <= b.length ? a : b;
  const s2 = a.length <= b.length ? b : a;

  const matchWindow = Math.max(Math.floor(s2.length / 2) - 1, 0);
  const s1Matches = new Array(s1.length).fill(false);
  const s2Matches = new Array(s2.length).fill(false);

  let matches = 0;
  let transpositions = 0;

  for (let i = 0; i < s1.length; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, s2.length);

    for (let j = start; j < end; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0;

  let k = 0;
  for (let i = 0; i < s1.length; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }

  const jaro =
    (matches / s1.length + matches / s2.length + (matches - transpositions / 2) / matches) / 3;

  // Winkler boost: reward common prefix up to 4 chars
  let prefix = 0;
  for (let i = 0; i < Math.min(4, s1.length, s2.length); i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }

  return jaro + prefix * 0.1 * (1 - jaro);
}

/**
 * Token Sort Ratio — sorts words alphabetically then compares.
 * Catches word order differences like "The Final Empire" vs "Final Empire The".
 */
export function tokenSortRatio(a: string, b: string): number {
  const sorted1 = a.split(/\s+/).sort().join(' ');
  const sorted2 = b.split(/\s+/).sort().join(' ');
  return bigramJaccard(sorted1, sorted2);
}

/**
 * Bigram Jaccard similarity with length penalty.
 */
export function bigramJaccard(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;

  const bigrams1 = getBigrams(a);
  const bigrams2 = getBigrams(b);

  if (bigrams1.size === 0 && bigrams2.size === 0) return 1;
  if (bigrams1.size === 0 || bigrams2.size === 0) return 0;

  let intersection = 0;
  for (const bigram of bigrams1) {
    if (bigrams2.has(bigram)) intersection++;
  }

  const rawScore = (2 * intersection) / (bigrams1.size + bigrams2.size);

  // Length penalty: if strings differ greatly in length, reduce score
  const lenRatio = Math.min(a.length, b.length) / Math.max(a.length, b.length);
  const lengthPenalty = lenRatio < 0.4 ? lenRatio : 1;
  return rawScore * lengthPenalty;
}

function getBigrams(str: string): Set<string> {
  const bigrams = new Set<string>();
  for (let i = 0; i < str.length - 1; i++) {
    bigrams.add(str.substring(i, i + 2));
  }
  return bigrams;
}

/**
 * Normalize a title/name for comparison:
 * Unicode NFKC, accent folding, lowercase, remove articles, punctuation.
 */
export function normalizeForComparison(text: string): string {
  return text
    // Unicode NFKC normalization
    .normalize('NFKC')
    // Accent folding: é→e, ü→u, etc.
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    // & → and
    .replace(/\s*&\s*/g, ' and ')
    .replace(/^(the|a|an)\s+/i, '')
    .replaceAll(/[^\w\s]/g, '')
    .replaceAll(/\s+/g, ' ')
    .trim();
}
