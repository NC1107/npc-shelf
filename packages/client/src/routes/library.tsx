import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Grid3X3, List, Search, SlidersHorizontal, X, BookOpen } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Select } from '../components/ui/select';
import { Badge } from '../components/ui/badge';
import { Card, CardContent } from '../components/ui/card';
import { BookCard } from '../components/books/BookCard';
import { api } from '../lib/api';
import { useUiStore } from '../stores/uiStore';
import type { PaginatedResponse, Book } from '@npc-shelf/shared';

interface FilterOptions {
  authors: { id: number; name: string }[];
  series: { id: number; name: string }[];
  formats: string[];
}

export function LibraryPage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState('title');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [format, setFormat] = useState('');
  const [authorId, setAuthorId] = useState('');
  const [seriesId, setSeriesId] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const { libraryView, setLibraryView } = useUiStore();

  const activeFilterCount = [format, authorId, seriesId].filter(Boolean).length;

  const { data: filters } = useQuery({
    queryKey: ['book-filters'],
    queryFn: () => api.get<FilterOptions>('/books/filters'),
  });

  const queryParams = new URLSearchParams();
  queryParams.set('page', String(page));
  queryParams.set('pageSize', '24');
  queryParams.set('sortBy', sortBy);
  queryParams.set('sortOrder', sortOrder);
  if (search) queryParams.set('q', search);
  if (format) queryParams.set('format', format);
  if (authorId) queryParams.set('authorId', authorId);
  if (seriesId) queryParams.set('seriesId', seriesId);

  const { data, isLoading } = useQuery({
    queryKey: ['books', { page, sortBy, sortOrder, q: search, format, authorId, seriesId }],
    queryFn: () => api.get<PaginatedResponse<Book>>(`/books?${queryParams.toString()}`),
  });

  const clearFilters = () => {
    setFormat('');
    setAuthorId('');
    setSeriesId('');
    setPage(1);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Library</h1>
          {data && (
            <p className="text-sm text-muted-foreground">
              {data.total} {data.total === 1 ? 'book' : 'books'}
            </p>
          )}
        </div>
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

      {/* Search and controls */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-md">
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
        <Select
          value={sortBy}
          onChange={(e) => { setSortBy(e.target.value); setPage(1); }}
        >
          <option value="title">Title</option>
          <option value="createdAt">Date Added</option>
          <option value="updatedAt">Last Updated</option>
        </Select>
        <Button
          variant="outline"
          size="icon"
          onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
          title={sortOrder === 'asc' ? 'Ascending' : 'Descending'}
        >
          {sortOrder === 'asc' ? '↑' : '↓'}
        </Button>
        <Button
          variant={showFilters ? 'secondary' : 'outline'}
          onClick={() => setShowFilters(!showFilters)}
          className="gap-1.5"
        >
          <SlidersHorizontal className="h-4 w-4" />
          Filters
          {activeFilterCount > 0 && (
            <Badge variant="default" className="ml-1 h-5 w-5 rounded-full p-0 text-[10px] flex items-center justify-center">
              {activeFilterCount}
            </Badge>
          )}
        </Button>
      </div>

      {/* Filter panel */}
      {showFilters && (
        <Card>
          <CardContent className="flex flex-wrap gap-3 p-4">
            {filters?.formats && filters.formats.length > 0 && (
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Format</label>
                <Select value={format} onChange={(e) => { setFormat(e.target.value); setPage(1); }}>
                  <option value="">All formats</option>
                  {filters.formats.map((f) => (
                    <option key={f} value={f}>{f.toUpperCase()}</option>
                  ))}
                </Select>
              </div>
            )}
            {filters?.authors && filters.authors.length > 0 && (
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Author</label>
                <Select value={authorId} onChange={(e) => { setAuthorId(e.target.value); setPage(1); }}>
                  <option value="">All authors</option>
                  {filters.authors.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </Select>
              </div>
            )}
            {filters?.series && filters.series.length > 0 && (
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Series</label>
                <Select value={seriesId} onChange={(e) => { setSeriesId(e.target.value); setPage(1); }}>
                  <option value="">All series</option>
                  {filters.series.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </Select>
              </div>
            )}
            {activeFilterCount > 0 && (
              <div className="flex items-end">
                <Button variant="ghost" size="sm" onClick={clearFilters}>
                  <X className="h-3 w-3" />
                  Clear
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Book grid/list */}
      {isLoading ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="animate-pulse">
              <div className="aspect-[2/3] rounded-lg bg-muted" />
              <div className="mt-2 h-4 rounded bg-muted" />
              <div className="mt-1 h-3 w-2/3 rounded bg-muted" />
            </div>
          ))}
        </div>
      ) : data?.items && data.items.length > 0 ? (
        <>
          {libraryView === 'grid' ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {data.items.map((book) => (
                <BookCard key={book.id} book={book as any} view="grid" />
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {data.items.map((book) => (
                <BookCard key={book.id} book={book as any} view="list" />
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
              <div className="flex items-center gap-1">
                {generatePageNumbers(page, data.totalPages).map((p, i) =>
                  p === '...' ? (
                    <span key={`ellipsis-${i}`} className="px-2 text-muted-foreground">...</span>
                  ) : (
                    <Button
                      key={p}
                      variant={p === page ? 'default' : 'outline'}
                      size="sm"
                      className="w-9"
                      onClick={() => setPage(p as number)}
                    >
                      {p}
                    </Button>
                  ),
                )}
              </div>
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
            <p className="text-lg font-medium">
              {search || activeFilterCount > 0 ? 'No books match your filters' : 'No books in your library yet'}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              {search || activeFilterCount > 0
                ? 'Try adjusting your search or filters'
                : 'Add a library in Settings and scan to import your books'}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function generatePageNumbers(current: number, total: number): (number | '...')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | '...')[] = [1];
  if (current > 3) pages.push('...');
  for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) {
    pages.push(i);
  }
  if (current < total - 2) pages.push('...');
  pages.push(total);
  return pages;
}
