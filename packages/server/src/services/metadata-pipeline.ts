import type { MetadataProvider } from '../providers/metadata-provider.js';
import type { MetadataMatchResult } from '@npc-shelf/shared';
import { METADATA } from '@npc-shelf/shared';
import { stringSimilarity, normalizeForComparison } from '../utils/string-similarity.js';

/**
 * Metadata matching orchestration with confidence scoring.
 * Pipeline: ISBN -> Title+Author -> Title-only
 * Full implementation in Phase 4.
 */
export async function matchBook(
  provider: MetadataProvider,
  title: string,
  author?: string,
  isbn?: string,
): Promise<MetadataMatchResult | null> {
  // Step 1: Search by ISBN (highest confidence)
  if (isbn) {
    const results = await provider.searchByIsbn(isbn);
    if (results.length > 0) {
      return {
        ...results[0],
        confidence: METADATA.HIGH_CONFIDENCE_THRESHOLD,
        provider: provider.name,
      };
    }
  }

  // Step 2: Search by title + author
  const results = await provider.searchByTitle(title, author);
  if (results.length === 0) return null;

  // Score results by similarity
  const scored = results.map((result) => {
    const titleSim = stringSimilarity(
      normalizeForComparison(title),
      normalizeForComparison(result.title),
    );
    const authorSim = author && result.authors.length > 0
      ? stringSimilarity(
          normalizeForComparison(author),
          normalizeForComparison(result.authors[0]),
        )
      : 0;

    const confidence = author
      ? titleSim * 0.6 + authorSim * 0.4
      : titleSim * 0.8;

    return { ...result, confidence, provider: provider.name };
  });

  scored.sort((a, b) => b.confidence - a.confidence);
  const best = scored[0];

  return best.confidence >= METADATA.LOW_CONFIDENCE_THRESHOLD ? best : null;
}
