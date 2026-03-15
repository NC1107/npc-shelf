import { useState, useEffect, useRef, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Search as SearchIcon, BookOpen, User, Layers, ArrowRight, Headphones } from 'lucide-react';
import { Input } from '../components/ui/input';
import { Card, CardContent } from '../components/ui/card';
import { BookCard } from '../components/books/BookCard';
import { api } from '../lib/api';
import type { Book, Author, Series } from '@npc-shelf/shared';

interface SearchBook extends Book {
  formats?: string[];
  authors?: { author: { name: string } }[];
}

interface SearchResults {
  books: SearchBook[];
  authors: Author[];
  series: Series[];
}

const AUDIO_FORMATS = new Set(['m4b', 'mp3']);
const EBOOK_FORMATS = new Set(['epub', 'pdf', 'mobi', 'azw3']);

export function SearchPage() {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input on mount and Cmd+K
  useEffect(() => {
    inputRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ['search', query],
    queryFn: () => api.get<SearchResults>(`/search?q=${encodeURIComponent(query)}`),
    enabled: query.length >= 2,
  });

  const hasResults = data && (data.books.length > 0 || data.authors.length > 0 || data.series.length > 0);

  // Split books by format (memoized to avoid re-filtering on every render)
  const { audiobooks, ebooks, hasMixedFormats } = useMemo(() => {
    const books = data?.books || [];
    const audio = books.filter(b => b.formats?.some(f => AUDIO_FORMATS.has(f)));
    const ebook = books.filter(b => b.formats?.some(f => EBOOK_FORMATS.has(f)) && !b.formats?.some(f => AUDIO_FORMATS.has(f)));
    return { audiobooks: audio, ebooks: ebook, hasMixedFormats: audio.length > 0 && ebook.length > 0 };
  }, [data?.books]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Search</h1>

      <div className="relative max-w-lg">
        <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inputRef}
          placeholder="Search books, authors, series... (Ctrl+K)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-9 h-11 text-base"
        />
      </div>

      {query.length < 2 && (
        <p className="text-sm text-muted-foreground">Type at least 2 characters to search</p>
      )}

      {isLoading && query.length >= 2 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={`skeleton-${i}`} className="animate-pulse"> {/* NOSONAR - static skeleton placeholders */}
              <div className="aspect-[2/3] rounded-lg bg-muted" />
              <div className="mt-2 h-4 rounded bg-muted" />
            </div>
          ))}
        </div>
      )}

      {data && !isLoading && (
        <div className="space-y-8">
          {/* Books — grouped by format if we have both types */}
          {data.books.length > 0 && !hasMixedFormats && (
            <section>
              <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
                <BookOpen className="h-5 w-5" />
                Books
                <span className="text-sm font-normal text-muted-foreground">({data.books.length})</span>
              </h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                {data.books.map((book) => (
                  <BookCard key={book.id} book={book} view="grid" />
                ))}
              </div>
            </section>
          )}

          {hasMixedFormats && audiobooks.length > 0 && (
            <section>
              <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
                <Headphones className="h-5 w-5" />
                Audiobooks
                <span className="text-sm font-normal text-muted-foreground">({audiobooks.length})</span>
              </h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                {audiobooks.map((book) => (
                  <BookCard key={book.id} book={book} view="grid" />
                ))}
              </div>
            </section>
          )}

          {hasMixedFormats && ebooks.length > 0 && (
            <section>
              <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
                <BookOpen className="h-5 w-5" />
                Ebooks
                <span className="text-sm font-normal text-muted-foreground">({ebooks.length})</span>
              </h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                {ebooks.map((book) => (
                  <BookCard key={book.id} book={book} view="grid" />
                ))}
              </div>
            </section>
          )}

          {/* Authors */}
          {data.authors.length > 0 && (
            <section>
              <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
                <User className="h-5 w-5" />
                Authors
                <span className="text-sm font-normal text-muted-foreground">({data.authors.length})</span>
              </h2>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {data.authors.map((author) => (
                  <Link
                    key={author.id}
                    to="/library"
                    search={{ authorId: String(author.id) } as any}
                    className="flex items-center justify-between rounded-lg border bg-card p-3 transition-colors hover:bg-accent"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                        <User className="h-5 w-5 text-muted-foreground" />
                      </div>
                      <span className="font-medium">{author.name}</span>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* Series */}
          {data.series.length > 0 && (
            <section>
              <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
                <Layers className="h-5 w-5" />
                Series
                <span className="text-sm font-normal text-muted-foreground">({data.series.length})</span>
              </h2>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {data.series.map((s) => (
                  <Link
                    key={s.id}
                    to="/library"
                    search={{ seriesId: String(s.id) } as any}
                    className="flex items-center justify-between rounded-lg border bg-card p-3 transition-colors hover:bg-accent"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                        <Layers className="h-5 w-5 text-muted-foreground" />
                      </div>
                      <span className="font-medium">{s.name}</span>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  </Link>
                ))}
              </div>
            </section>
          )}

          {!hasResults && (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <SearchIcon className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-lg font-medium">No results found</p>
                <p className="text-sm text-muted-foreground mt-1">
                  No matches for "{query}" — try a different search term
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
