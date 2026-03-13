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

const SEARCH_QUERY = gql`
  query SearchBooks($q: String!, $perPage: Int!) {
    search(query: $q, query_type: "Book", per_page: $perPage) {
      results
    }
  }
`;

const BOOK_BY_PK_QUERY = gql`
  query GetBook($id: Int!) {
    books_by_pk(id: $id) {
      id
      title
      description
      pages
      release_date
      isbn_13
      isbn_10
      slug
      image { url }
      contributions { author { id name } }
      book_series { series { id name } position }
      cached_tags
    }
  }
`;

/**
 * Hardcover GraphQL metadata provider.
 * Uses the search() query (Typesense-backed) for book lookups.
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
      const data = await this.client.request<SearchResponse>(SEARCH_QUERY, {
        q: isbn,
        perPage: 5,
      });
      return parseSearchResults(data.search.results);
    } catch (err: any) {
      console.error('[Hardcover] ISBN search error:', err.message);
      return [];
    }
  }

  async searchByTitle(title: string, author?: string): Promise<MetadataSearchResult[]> {
    await this.bucket.acquire();
    try {
      const q = author ? `${title} ${author}` : title;
      const data = await this.client.request<SearchResponse>(SEARCH_QUERY, {
        q,
        perPage: 10,
      });
      return parseSearchResults(data.search.results);
    } catch (err: any) {
      console.error('[Hardcover] Title search error:', err.message);
      return [];
    }
  }

  async getDetails(externalId: string): Promise<MetadataSearchResult | null> {
    await this.bucket.acquire();
    try {
      const data = await this.client.request<{ books_by_pk: HardcoverBook | null }>(
        BOOK_BY_PK_QUERY,
        { id: parseInt(externalId) },
      );
      return data.books_by_pk ? mapBookToResult(data.books_by_pk) : null;
    } catch (err: any) {
      console.error('[Hardcover] Detail fetch error:', err.message);
      return null;
    }
  }
}

// ===== Typesense search response types =====

interface SearchResponse {
  search: { results: TypesenseResults | string };
}

interface TypesenseResults {
  found: number;
  hits: TypesenseHit[];
}

interface TypesenseHit {
  document: TypesenseDocument;
}

interface TypesenseDocument {
  id: string;
  title: string;
  description?: string;
  author_names?: string[];
  image?: { url: string };
  isbns?: string[];
  featured_series?: { name: string; position: number } | null;
  pages?: number;
  release_date?: string;
}

function parseSearchResults(results: TypesenseResults | string): MetadataSearchResult[] {
  // results may come as a JSON string or parsed object
  const parsed: TypesenseResults = typeof results === 'string' ? JSON.parse(results) : results;
  if (!parsed?.hits) return [];

  return parsed.hits.map((hit) => {
    const doc = hit.document;
    const isbn13 = doc.isbns?.find((i) => i.length === 13) || null;
    return {
      externalId: String(doc.id),
      title: doc.title,
      subtitle: null,
      authors: doc.author_names || [],
      description: doc.description || null,
      coverUrl: doc.image?.url || null,
      publishDate: doc.release_date || null,
      isbn13,
      pageCount: doc.pages || null,
      isbn10: null,
      tags: null,
      series: doc.featured_series?.name || null,
      seriesPosition: doc.featured_series?.position ?? null,
      slug: null, // Typesense search doesn't include slug
      allSeries: null, // Only available via books_by_pk
    };
  });
}

// ===== books_by_pk response types =====

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

function mapBookToResult(book: HardcoverBook): MetadataSearchResult {
  return {
    externalId: String(book.id),
    title: book.title,
    subtitle: null,
    authors: book.contributions.map((c) => c.author.name),
    description: book.description || null,
    coverUrl: book.image?.url || null,
    publishDate: book.release_date || null,
    isbn13: book.isbn_13 || null,
    pageCount: book.pages || null,
    isbn10: book.isbn_10 || null,
    tags: book.cached_tags || null,
    series: book.book_series.length > 0 ? book.book_series[0]!.series.name : null,
    seriesPosition: book.book_series.length > 0 ? book.book_series[0]!.position : null,
    slug: book.slug || null,
    allSeries: book.book_series.map((bs) => ({
      name: bs.series.name,
      position: bs.position,
      seriesId: String(bs.series.id),
    })),
  };
}
