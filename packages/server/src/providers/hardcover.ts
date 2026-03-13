import { GraphQLClient, gql } from 'graphql-request';
import type { MetadataProvider } from './metadata-provider.js';
import type { MetadataSearchResult } from '@npc-shelf/shared';

// Token bucket rate limiter — 60 requests per minute
class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  constructor(private maxTokens: number, private refillRate: number) {
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
  }

  async acquire(): Promise<void> {
    this.refill();
    if (this.tokens <= 0) {
      const waitMs = ((1 / this.refillRate) * 1000) + 50;
      await new Promise((r) => setTimeout(r, waitMs));
      this.refill();
    }
    this.tokens--;
  }

  private refill() {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }
}

const BOOK_FIELDS = gql`
  fragment BookFields on books {
    id
    title
    description
    pages
    release_date
    isbn_13
    isbn_10
    slug
    image {
      url
    }
    contributions {
      author {
        id
        name
      }
    }
    book_series {
      series {
        id
        name
      }
      position
    }
    cached_tags
  }
`;

/**
 * Hardcover GraphQL metadata provider.
 * Rate limited to 60 req/min via token bucket.
 */
export class HardcoverProvider implements MetadataProvider {
  name = 'hardcover';
  private client: GraphQLClient;
  private bucket = new TokenBucket(60, 1); // 60 tokens, refill 1/sec

  constructor(apiToken?: string) {
    this.client = new GraphQLClient('https://api.hardcover.app/v1/graphql', {
      headers: apiToken ? { Authorization: `Bearer ${apiToken}` } : {},
    });
  }

  setToken(token: string) {
    this.client = new GraphQLClient('https://api.hardcover.app/v1/graphql', {
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  async searchByIsbn(isbn: string): Promise<MetadataSearchResult[]> {
    await this.bucket.acquire();
    try {
      const field = isbn.length === 13 ? 'isbn_13' : 'isbn_10';
      const query = gql`
        ${BOOK_FIELDS}
        query SearchByIsbn($isbn: String!) {
          books(where: { ${field}: { _eq: $isbn } }, limit: 5) {
            ...BookFields
          }
        }
      `;
      const data = await this.client.request<{ books: HardcoverBook[] }>(query, { isbn });
      return data.books.map(mapToSearchResult);
    } catch (err: any) {
      console.error('[Hardcover] ISBN search error:', err.message);
      return [];
    }
  }

  async searchByTitle(title: string, author?: string): Promise<MetadataSearchResult[]> {
    await this.bucket.acquire();
    try {
      let query: string;
      let variables: Record<string, any>;

      if (author) {
        query = gql`
          ${BOOK_FIELDS}
          query SearchByTitleAuthor($title: String!, $author: String!) {
            books(
              where: {
                _and: [
                  { title: { _ilike: $title } }
                  { contributions: { author: { name: { _ilike: $author } } } }
                ]
              }
              order_by: { users_read_count: desc }
              limit: 10
            ) {
              ...BookFields
            }
          }
        `;
        variables = { title: `%${title}%`, author: `%${author}%` };
      } else {
        query = gql`
          ${BOOK_FIELDS}
          query SearchByTitle($title: String!) {
            books(
              where: { title: { _ilike: $title } }
              order_by: { users_read_count: desc }
              limit: 10
            ) {
              ...BookFields
            }
          }
        `;
        variables = { title: `%${title}%` };
      }

      const data = await this.client.request<{ books: HardcoverBook[] }>(query, variables);
      return data.books.map(mapToSearchResult);
    } catch (err: any) {
      console.error('[Hardcover] Title search error:', err.message);
      return [];
    }
  }

  async getDetails(externalId: string): Promise<MetadataSearchResult | null> {
    await this.bucket.acquire();
    try {
      const query = gql`
        ${BOOK_FIELDS}
        query GetBook($id: Int!) {
          books_by_pk(id: $id) {
            ...BookFields
          }
        }
      `;
      const data = await this.client.request<{ books_by_pk: HardcoverBook | null }>(query, {
        id: parseInt(externalId),
      });
      return data.books_by_pk ? mapToSearchResult(data.books_by_pk) : null;
    } catch (err: any) {
      console.error('[Hardcover] Detail fetch error:', err.message);
      return null;
    }
  }
}

interface HardcoverBook {
  id: number;
  title: string;
  description: string | null;
  pages: number | null;
  release_date: string | null;
  isbn_13: string | null;
  isbn_10: string | null;
  slug: string | null;
  image: { url: string } | null;
  contributions: { author: { id: number; name: string } }[];
  book_series: { series: { id: number; name: string }; position: number | null }[];
  cached_tags: string[] | null;
}

function mapToSearchResult(book: HardcoverBook): MetadataSearchResult {
  return {
    externalId: String(book.id),
    title: book.title,
    subtitle: null,
    authors: book.contributions.map((c) => c.author.name),
    description: book.description || null,
    coverUrl: book.image?.url || null,
    publishDate: book.release_date || null,
    isbn13: book.isbn_13 || null,
    series: book.book_series.length > 0 ? book.book_series[0]!.series.name : null,
    seriesPosition: book.book_series.length > 0 ? book.book_series[0]!.position : null,
  };
}
