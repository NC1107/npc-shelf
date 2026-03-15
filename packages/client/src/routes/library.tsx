import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Grid3X3,
  List,
  Search,
  SlidersHorizontal,
  X,
  BookOpen,
  CheckSquare,
  Square,
  Trash2,
  Sparkles,
  Tag,
  MousePointerClick,
  AlertCircle,
} from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Select } from '../components/ui/select';
import { Badge } from '../components/ui/badge';
import { Card, CardContent } from '../components/ui/card';
import { Combobox } from '../components/ui/combobox';
import { BookCard } from '../components/books/BookCard';
import { api } from '../lib/api';
import { useUiStore } from '../stores/uiStore';
import type { PaginatedResponse, Book } from '@npc-shelf/shared';
import { useState, useCallback } from 'react';

interface FilterOptions {
  authors: { id: number; name: string }[];
  series: { id: number; name: string }[];
  formats: string[];
}

// -- Sub-components extracted to reduce cognitive complexity --

function SelectableBookCard({
  book,
  view,
  isSelected,
  onToggle,
}: Readonly<{
  book: Book;
  view: 'grid' | 'list';
  isSelected: boolean;
  onToggle: (id: number) => void;
}>) {
  return (
    <button
      type="button"
      className="relative cursor-pointer block w-full text-left"
      aria-pressed={isSelected}
      onClick={() => onToggle(book.id)}
    >
      <div className="pointer-events-none">
        <BookCard book={book as any} view={view} />
      </div>
      <div
        className={`absolute inset-0 rounded-lg transition-colors ${isSelected ? 'bg-primary/10 ring-2 ring-primary' : 'hover:bg-muted/30'}`}
      />
      <div className="absolute top-2 right-2 z-10">
        {isSelected ? (
          <CheckSquare className="h-5 w-5 text-primary drop-shadow-md" />
        ) : (
          <Square className="h-5 w-5 text-muted-foreground drop-shadow-md" />
        )}
      </div>
    </button>
  );
}

function BulkActionBar({
  selectedCount,
  onSelectAll,
  onDeselectAll,
  onDelete,
  onMatch,
  onTag,
  isBulkLoading,
}: Readonly<{
  selectedCount: number;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onDelete: () => void;
  onMatch: () => void;
  onTag: (tags: string[]) => void;
  isBulkLoading: boolean;
}>) {
  const [showTagInput, setShowTagInput] = useState(false);
  const [tagInput, setTagInput] = useState('');

  const handleSubmitTag = () => {
    const tags = tagInput.split(',').map((t) => t.trim()).filter(Boolean);
    if (tags.length > 0) {
      onTag(tags);
      setShowTagInput(false);
      setTagInput('');
    }
  };

  const handleCancelTag = () => {
    setShowTagInput(false);
    setTagInput('');
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-3">
          <Badge variant="secondary" className="text-sm" role="status" aria-live="polite">
            {selectedCount} selected
          </Badge>
          <Button variant="ghost" size="sm" onClick={onSelectAll}>
            Select All
          </Button>
          <Button variant="ghost" size="sm" onClick={onDeselectAll}>
            Deselect All
          </Button>
        </div>

        <div className="flex items-center gap-2">
          {showTagInput ? (
            <div className="flex items-center gap-1.5">
              <Input
                placeholder="Tag name(s), comma-separated"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSubmitTag();
                  if (e.key === 'Escape') handleCancelTag();
                }}
                className="h-8 w-56"
                autoFocus
              />
              <Button
                size="sm"
                onClick={handleSubmitTag}
                disabled={!tagInput.trim() || isBulkLoading}
              >
                Apply
              </Button>
              <Button variant="ghost" size="sm" onClick={handleCancelTag}>
                <X className="h-3 w-3" />
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowTagInput(true)}
              disabled={isBulkLoading}
              className="gap-1.5"
            >
              <Tag className="h-3.5 w-3.5" />
              Add Tag
            </Button>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={onMatch}
            disabled={isBulkLoading}
            className="gap-1.5"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Match Metadata
          </Button>

          <Button
            variant="destructive"
            size="sm"
            onClick={onDelete}
            disabled={isBulkLoading}
            className="gap-1.5"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </Button>
        </div>
      </div>
    </div>
  );
}

function FilterPanel({
  filters,
  format,
  authorId,
  seriesId,
  activeFilterCount,
  setLibraryFilters,
}: Readonly<{
  filters: FilterOptions | undefined;
  format: string;
  authorId: string;
  seriesId: string;
  activeFilterCount: number;
  setLibraryFilters: (filters: Record<string, any>) => void;
}>) {
  return (
    <Card>
      <CardContent className="flex flex-wrap gap-3 p-4">
        {filters?.formats && filters.formats.length > 0 && (
          <div className="space-y-1">
            <label htmlFor="filter-format" className="text-xs font-medium text-muted-foreground">Format</label>
            <Select id="filter-format" value={format} onChange={(e) => { setLibraryFilters({ libraryFormat: e.target.value, libraryPage: 1 }); }}>
              <option value="">All formats</option>
              {filters.formats.map((f) => (
                <option key={f} value={f}>{f.toUpperCase()}</option>
              ))}
            </Select>
          </div>
        )}
        {filters?.authors && filters.authors.length > 0 && (
          <div className="space-y-1">
            <span id="filter-author-label" className="text-xs font-medium text-muted-foreground">Author</span>
            <Combobox
              options={filters.authors.map(a => ({ value: String(a.id), label: a.name }))}
              value={authorId}
              onChange={(v) => setLibraryFilters({ libraryAuthorId: v, libraryPage: 1 })}
              placeholder="All authors"
              aria-labelledby="filter-author-label"
            />
          </div>
        )}
        {filters?.series && filters.series.length > 0 && (
          <div className="space-y-1">
            <span id="filter-series-label" className="text-xs font-medium text-muted-foreground">Series</span>
            <Combobox
              options={filters.series.map(s => ({ value: String(s.id), label: s.name }))}
              value={seriesId}
              onChange={(v) => setLibraryFilters({ librarySeriesId: v, libraryPage: 1 })}
              placeholder="All series"
              aria-labelledby="filter-series-label"
            />
          </div>
        )}
        {activeFilterCount > 0 && (
          <div className="flex items-end">
            <Button variant="ghost" size="sm" onClick={() => {
              setLibraryFilters({ libraryFormat: '', libraryAuthorId: '', librarySeriesId: '', libraryNeedsReview: false, libraryPage: 1 });
            }}>
              <X className="h-3 w-3" />
              Clear
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EmptyState({ hasFilters }: Readonly<{ hasFilters: boolean }>) {
  const title = hasFilters
    ? 'No books match your filters'
    : 'No books in your library yet';
  const subtitle = hasFilters
    ? 'Try adjusting your search or filters'
    : 'Add a library in Settings and scan to import your books';

  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center py-12">
        <BookOpen className="h-12 w-12 text-muted-foreground mb-4" />
        <p className="text-lg font-medium">{title}</p>
        <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
      </CardContent>
    </Card>
  );
}

function LoadingSkeleton() {
  return (
    <output aria-busy="true" className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
      <span className="sr-only">Loading books</span>
      {['a','b','c','d','e','f','g','h','i','j','k','l'].map((id) => (
        <div key={id} className="animate-pulse">
          <div className="aspect-[2/3] rounded-lg bg-muted" />
          <div className="mt-2 h-4 rounded bg-muted" />
          <div className="mt-1 h-3 w-2/3 rounded bg-muted" />
        </div>
      ))}
    </output>
  );
}

function BookGrid({
  items,
  view,
  selectMode,
  selectedIds,
  onToggle,
}: Readonly<{
  items: Book[];
  view: 'grid' | 'list';
  selectMode: boolean;
  selectedIds: Set<number>;
  onToggle: (id: number) => void;
}>) {
  const containerClass = view === 'grid'
    ? 'grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6'
    : 'space-y-2';

  return (
    <div className={containerClass}>
      {items.map((book) =>
        selectMode ? (
          <SelectableBookCard
            key={book.id}
            book={book}
            view={view}
            isSelected={selectedIds.has(book.id)}
            onToggle={onToggle}
          />
        ) : (
          <BookCard key={book.id} book={book as any} view={view} />
        ),
      )}
    </div>
  );
}

function LibraryPagination({
  page,
  totalPages,
  onPageChange,
}: Readonly<{
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}>) {
  const pageNumbers = generatePageNumbers(page, totalPages);

  return (
    <nav aria-label="Pagination" className="flex items-center justify-center gap-2 pt-4">
      <Button
        variant="outline"
        size="sm"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        Previous
      </Button>
      <div className="flex items-center gap-1">
        {pageNumbers.map((p) => {
          if (p === '...') {
            return <span key={`ellipsis-before-${p}`} className="px-2 text-muted-foreground">...</span>;
          }
          return (
            <Button
              key={`page-${p}`}
              variant={p === page ? 'default' : 'outline'}
              size="sm"
              className="w-9"
              onClick={() => onPageChange(p)}
              {...(p === page ? { 'aria-current': 'page' as const } : {})}
            >
              {p}
            </Button>
          );
        })}
      </div>
      <Button
        variant="outline"
        size="sm"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
      >
        Next
      </Button>
    </nav>
  );
}

// -- Main component --

export function LibraryPage() {
  const {
    librarySearch: search,
    libraryPage: page,
    librarySortBy: sortBy,
    librarySortOrder: sortOrder,
    libraryFormat: format,
    libraryAuthorId: authorId,
    librarySeriesId: seriesId,
    libraryNeedsReview: needsReview,
    libraryView,
    setLibraryFilters,
    clearLibraryFilters,
    setLibraryView,
  } = useUiStore();

  const [showFilters, setShowFilters] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const queryClient = useQueryClient();

  const activeFilterCount = [format, authorId, seriesId, needsReview].filter(Boolean).length;
  const hasAnyFilter = !!search || activeFilterCount > 0;

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
  if (needsReview) queryParams.set('needsReview', 'true');

  const { data, isLoading } = useQuery({
    queryKey: ['books', { page, sortBy, sortOrder, q: search, format, authorId, seriesId, needsReview }],
    queryFn: () => api.get<PaginatedResponse<Book>>(`/books?${queryParams.toString()}`),
  });

  const toggleSelection = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    if (data?.items) {
      setSelectedIds(new Set(data.items.map((b) => b.id)));
    }
  }, [data?.items]);

  const deselectAll = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedIds(new Set());
  }, []);

  // Bulk mutations
  const bulkDelete = useMutation({
    mutationFn: (bookIds: number[]) => api.post('/books/bulk/delete', { bookIds }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['books'] });
      queryClient.invalidateQueries({ queryKey: ['book-filters'] });
      exitSelectMode();
    },
  });

  const bulkMatch = useMutation({
    mutationFn: (bookIds: number[]) => api.post('/books/bulk/match', { bookIds }),
    onSuccess: () => {
      exitSelectMode();
    },
  });

  const bulkTag = useMutation({
    mutationFn: ({ bookIds, addTags }: { bookIds: number[]; addTags: string[] }) =>
      api.post('/books/bulk/tag', { bookIds, addTags }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['books'] });
      exitSelectMode();
    },
  });

  const selectedArray = Array.from(selectedIds);
  const isBulkLoading = bulkDelete.isPending || bulkMatch.isPending || bulkTag.isPending;

  const handleBulkDelete = () => {
    if (selectedArray.length === 0) return;
    const count = selectedArray.length;
    const noun = count === 1 ? 'book' : 'books';
    if (globalThis.confirm(`Delete ${count} ${noun}? This cannot be undone.`)) {
      bulkDelete.mutate(selectedArray);
    }
  };

  const handleBulkMatch = () => {
    if (selectedArray.length === 0) return;
    bulkMatch.mutate(selectedArray);
  };

  const handleBulkTag = (tags: string[]) => {
    if (selectedArray.length === 0) return;
    bulkTag.mutate({ bookIds: selectedArray, addTags: tags });
  };

  const showBulkBar = selectMode && selectedIds.size > 0;

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
            variant={selectMode ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => selectMode ? exitSelectMode() : setSelectMode(true)}
            className="gap-1.5"
          >
            <MousePointerClick className="h-4 w-4" />
            {selectMode ? 'Cancel' : 'Select'}
          </Button>
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
              setLibraryFilters({ librarySearch: e.target.value, libraryPage: 1 });
            }}
            className="pl-9"
          />
        </div>
        <Select
          value={sortBy}
          onChange={(e) => { setLibraryFilters({ librarySortBy: e.target.value, libraryPage: 1 }); }}
        >
          <option value="title">Title</option>
          <option value="createdAt">Date Added</option>
          <option value="updatedAt">Last Updated</option>
        </Select>
        <Button
          variant="outline"
          size="icon"
          onClick={() => setLibraryFilters({ librarySortOrder: sortOrder === 'asc' ? 'desc' : 'asc' })}
          title={sortOrder === 'asc' ? 'Ascending' : 'Descending'}
          aria-label={sortOrder === 'asc' ? 'Sort ascending' : 'Sort descending'}
        >
          {sortOrder === 'asc' ? '\u2191' : '\u2193'}
        </Button>
        <Button
          variant={needsReview ? 'secondary' : 'outline'}
          onClick={() => setLibraryFilters({ libraryNeedsReview: !needsReview, libraryPage: 1 })}
          className="gap-1.5"
        >
          <AlertCircle className="h-4 w-4" />
          Needs Review
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
        {hasAnyFilter && (
          <Button variant="ghost" size="sm" onClick={clearLibraryFilters} className="text-muted-foreground">
            <X className="h-3 w-3" />
            Clear all
          </Button>
        )}
      </div>

      {/* Filter panel */}
      {showFilters && (
        <FilterPanel
          filters={filters}
          format={format}
          authorId={authorId}
          seriesId={seriesId}
          activeFilterCount={activeFilterCount}
          setLibraryFilters={setLibraryFilters}
        />
      )}

      {/* Book grid/list */}
      {isLoading && <LoadingSkeleton />}
      {!isLoading && data?.items && data.items.length > 0 && (
        <>
          <BookGrid
            items={data.items}
            view={libraryView}
            selectMode={selectMode}
            selectedIds={selectedIds}
            onToggle={toggleSelection}
          />
          {data.totalPages > 1 && (
            <LibraryPagination
              page={page}
              totalPages={data.totalPages}
              onPageChange={(p) => setLibraryFilters({ libraryPage: p })}
            />
          )}
          {showBulkBar && <div className="h-20" />}
        </>
      )}
      {!isLoading && (!data?.items || data.items.length === 0) && (
        <EmptyState hasFilters={hasAnyFilter} />
      )}

      {/* Floating bulk action bar */}
      {showBulkBar && (
        <BulkActionBar
          selectedCount={selectedIds.size}
          onSelectAll={selectAll}
          onDeselectAll={deselectAll}
          onDelete={handleBulkDelete}
          onMatch={handleBulkMatch}
          onTag={handleBulkTag}
          isBulkLoading={isBulkLoading}
        />
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
