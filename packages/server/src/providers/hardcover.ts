import type { MetadataProvider } from './metadata-provider.js';
import type { MetadataSearchResult } from '@npc-shelf/shared';

/**
 * Hardcover GraphQL metadata provider.
 * Rate limited to 60 req/min via token bucket.
 */
export class HardcoverProvider implements MetadataProvider {
  name = 'hardcover';
  private apiUrl = 'https://api.hardcover.app/v1/graphql';

  async searchByIsbn(isbn: string): Promise<MetadataSearchResult[]> {
    // TODO: Implement Hardcover GraphQL search by ISBN
    console.log('[Hardcover] Search by ISBN:', isbn);
    return [];
  }

  async searchByTitle(title: string, author?: string): Promise<MetadataSearchResult[]> {
    // TODO: Implement Hardcover GraphQL search by title/author
    console.log('[Hardcover] Search by title:', title, author);
    return [];
  }

  async getDetails(externalId: string): Promise<MetadataSearchResult | null> {
    // TODO: Implement Hardcover GraphQL detail fetch
    console.log('[Hardcover] Get details:', externalId);
    return null;
  }
}
