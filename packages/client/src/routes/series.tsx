import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { BookOpen, Layers, Search, ArrowUpDown } from 'lucide-react';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import { api } from '../lib/api';

interface SeriesWithCount {
  id: number;
  name: string;
  hardcoverId: string | null;
  description: string | null;
  bookCount: number;
  coverBookIds: number[];
}

type SortKey = 'name' | 'bookCount';

export function SeriesPage() {
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('name');

  const { data: seriesList, isLoading } = useQuery({
    queryKey: ['series'],
    queryFn: () => api.get<SeriesWithCount[]>('/series'),
  });

  const filtered = useMemo(() => {
    if (!seriesList) return [];
    let list = seriesList;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((s) => s.name.toLowerCase().includes(q));
    }
    return [...list].sort((a, b) => {
      if (sortBy === 'bookCount') return b.bookCount - a.bookCount;
      return a.name.localeCompare(b.name);
    });
  }, [seriesList, search, sortBy]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Series</h1>
        {seriesList && (
          <span className="text-sm text-muted-foreground">{seriesList.length} series</span>
        )}
      </div>

      {/* Search + sort */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search series..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button
          variant="outline"
          size="icon"
          onClick={() => setSortBy(sortBy === 'name' ? 'bookCount' : 'name')}
          title={sortBy === 'name' ? 'Sort by book count' : 'Sort by name'}
        >
          <ArrowUpDown className="h-4 w-4" />
        </Button>
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-40 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-12 text-center">
          <Layers className="mx-auto h-12 w-12 text-muted-foreground" />
          <p className="mt-3 text-lg font-medium">
            {search ? 'No series match your search' : 'No series found'}
          </p>
          <p className="text-sm text-muted-foreground">
            {search
              ? 'Try a different search term.'
              : 'Series are detected from metadata or filenames during library scanning.'}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((series) => (
            <Link
              key={series.id}
              to="/series/$seriesId"
              params={{ seriesId: String(series.id) }}
              className="group overflow-hidden rounded-lg border bg-card transition-all hover:shadow-md"
            >
              {/* Cover stack preview */}
              <div className="relative h-28 bg-muted/50 overflow-hidden">
                {series.coverBookIds.length > 0 ? (
                  <div className="flex h-full items-end justify-center gap-1.5 px-4 pb-2">
                    {series.coverBookIds.slice(0, 4).map((bookId, i) => (
                      <div
                        key={bookId}
                        className="relative overflow-hidden rounded shadow-md transition-transform group-hover:scale-105"
                        style={{
                          width: `${64 - i * 4}px`,
                          height: `${96 - i * 6}px`,
                          zIndex: 4 - i,
                          marginBottom: `${i * 2}px`,
                        }}
                      >
                        <img
                          src={`/api/books/${bookId}/cover/thumb`}
                          alt=""
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <Layers className="h-10 w-10 text-muted-foreground/30" />
                  </div>
                )}
              </div>

              {/* Series info */}
              <div className="p-3">
                <h3 className="font-semibold truncate group-hover:text-primary transition-colors">
                  {series.name}
                </h3>
                <div className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
                  <BookOpen className="h-3.5 w-3.5" />
                  {series.bookCount} {series.bookCount === 1 ? 'book' : 'books'}
                </div>
                {series.description && (
                  <p className="mt-1.5 text-xs text-muted-foreground line-clamp-2">{series.description}</p>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
