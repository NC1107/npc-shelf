import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { BookOpen, Grid3X3, List, Search } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card, CardContent } from '../components/ui/card';
import { api } from '../lib/api';
import { useUiStore } from '../stores/uiStore';
import type { PaginatedResponse, Book } from '@npc-shelf/shared';

export function LibraryPage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState('title');
  const { libraryView, setLibraryView } = useUiStore();

  const { data, isLoading } = useQuery({
    queryKey: ['books', { page, sortBy, q: search }],
    queryFn: () =>
      api.get<PaginatedResponse<Book>>(
        `/books?page=${page}&pageSize=24&sortBy=${sortBy}${search ? `&q=${encodeURIComponent(search)}` : ''}`,
      ),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Library</h1>
        <div className="flex items-center gap-2">
          <Button
            variant={libraryView === 'grid' ? 'secondary' : 'ghost'}
            size="icon"
            onClick={() => setLibraryView('grid')}
          >
            <Grid3X3 className="h-4 w-4" />
          </Button>
          <Button
            variant={libraryView === 'list' ? 'secondary' : 'ghost'}
            size="icon"
            onClick={() => setLibraryView('list')}
          >
            <List className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Search and filters */}
      <div className="flex gap-2">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search books..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="pl-9"
          />
        </div>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="rounded-md border border-input bg-background px-3 py-1 text-sm"
        >
          <option value="title">Title</option>
          <option value="createdAt">Date Added</option>
          <option value="updatedAt">Last Updated</option>
        </select>
      </div>

      {/* Book grid */}
      {isLoading ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="animate-pulse">
              <div className="aspect-[2/3] rounded-lg bg-muted" />
              <div className="mt-2 h-4 rounded bg-muted" />
            </div>
          ))}
        </div>
      ) : data?.items && data.items.length > 0 ? (
        <>
          {libraryView === 'grid' ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {data.items.map((book) => (
                <Link
                  key={book.id}
                  to="/library/$bookId"
                  params={{ bookId: String(book.id) }}
                  className="group overflow-hidden rounded-lg border bg-card transition-all hover:shadow-md"
                >
                  <div className="aspect-[2/3] bg-muted flex items-center justify-center overflow-hidden">
                    {book.coverPath ? (
                      <img
                        src={`/api/books/${book.id}/cover/thumb`}
                        alt={book.title}
                        className="h-full w-full object-cover transition-transform group-hover:scale-105"
                        loading="lazy"
                      />
                    ) : (
                      <BookOpen className="h-8 w-8 text-muted-foreground" />
                    )}
                  </div>
                  <div className="p-2">
                    <p className="truncate text-sm font-medium">{book.title}</p>
                    {book.subtitle && (
                      <p className="truncate text-xs text-muted-foreground">{book.subtitle}</p>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {data.items.map((book) => (
                <Link
                  key={book.id}
                  to="/library/$bookId"
                  params={{ bookId: String(book.id) }}
                  className="flex items-center gap-3 rounded-lg border bg-card p-3 transition-colors hover:bg-accent"
                >
                  <div className="h-16 w-11 shrink-0 overflow-hidden rounded bg-muted flex items-center justify-center">
                    {book.coverPath ? (
                      <img
                        src={`/api/books/${book.id}/cover/thumb`}
                        alt={book.title}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <BookOpen className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{book.title}</p>
                    {book.subtitle && (
                      <p className="truncate text-sm text-muted-foreground">{book.subtitle}</p>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}

          {/* Pagination */}
          {data.totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-4">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                Previous
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {page} of {data.totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= data.totalPages}
                onClick={() => setPage(page + 1)}
              >
                Next
              </Button>
            </div>
          )}
        </>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <BookOpen className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">
              {search ? 'No books match your search.' : 'No books in your library yet.'}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
