import type { MetadataSearchResult } from '@npc-shelf/shared';

/**
 * Pluggable metadata provider interface.
 * Implement this to add new metadata sources (Hardcover, OpenLibrary, Google Books, etc.)
 */
export interface MetadataProvider {
  name: string;

  /** Search by ISBN — highest confidence */
  searchByIsbn(isbn: string): Promise<MetadataSearchResult[]>;

  /** Search by title and optional author */
  searchByTitle(title: string, author?: string): Promise<MetadataSearchResult[]>;

  /** Get full details by external ID */
  getDetails(externalId: string): Promise<MetadataSearchResult | null>;
}
