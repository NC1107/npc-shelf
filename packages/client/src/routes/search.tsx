import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Search as SearchIcon, BookOpen, User, Layers } from 'lucide-react';
import { Input } from '../components/ui/input';
import { api } from '../lib/api';
import type { Book, Author, Series } from '@npc-shelf/shared';

interface SearchResults {
  books: Book[];
  authors: Author[];
  series: Series[];
}

export function SearchPage() {
  const [query, setQuery] = useState('');

  const { data } = useQuery({
    queryKey: ['search', query],
    queryFn: () => api.get<SearchResults>(`/search?q=${encodeURIComponent(query)}`),
    enabled: query.length >= 2,
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Search</h1>

      <div className="relative max-w-lg">
        <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search books, authors, series..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-9"
          autoFocus
        />
      </div>

      {data && (
        <div className="space-y-6">
          {/* Books */}
          {data.books.length > 0 && (
            <div>
              <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
                <BookOpen className="h-5 w-5" />
                Books ({data.books.length})
              </h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                {data.books.map((book) => (
                  <Link
                    key={book.id}
                    to="/library/$bookId"
                    params={{ bookId: String(book.id) }}
                    className="overflow-hidden rounded-lg border bg-card transition-colors hover:bg-accent"
                  >
                    <div className="aspect-[2/3] bg-muted flex items-center justify-center">
                      <BookOpen className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <div className="p-2">
                      <p className="truncate text-sm font-medium">{book.title}</p>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Authors */}
          {data.authors.length > 0 && (
            <div>
              <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
                <User className="h-5 w-5" />
                Authors ({data.authors.length})
              </h2>
              <div className="space-y-1">
                {data.authors.map((author) => (
                  <div
                    key={author.id}
                    className="rounded-lg border bg-card p-3 text-sm"
                  >
                    {author.name}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Series */}
          {data.series.length > 0 && (
            <div>
              <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
                <Layers className="h-5 w-5" />
                Series ({data.series.length})
              </h2>
              <div className="space-y-1">
                {data.series.map((s) => (
                  <div
                    key={s.id}
                    className="rounded-lg border bg-card p-3 text-sm"
                  >
                    {s.name}
                  </div>
                ))}
              </div>
            </div>
          )}

          {data.books.length === 0 && data.authors.length === 0 && data.series.length === 0 && (
            <p className="text-muted-foreground">No results found for "{query}"</p>
          )}
        </div>
      )}
    </div>
  );
}
