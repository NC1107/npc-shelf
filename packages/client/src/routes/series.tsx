import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { BookOpen, Layers } from 'lucide-react';
import { api } from '../lib/api';

interface SeriesWithCount {
  id: number;
  name: string;
  hardcoverId: string | null;
  bookCount: number;
}

export function SeriesPage() {
  const { data: seriesList, isLoading } = useQuery({
    queryKey: ['series'],
    queryFn: () => api.get<SeriesWithCount[]>('/series'),
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Series</h1>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : seriesList && seriesList.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {seriesList.map((series) => (
            <Link
              key={series.id}
              to="/series/$seriesId"
              params={{ seriesId: String(series.id) }}
              className="group rounded-lg border bg-card p-4 transition-colors hover:bg-muted/50"
            >
              <div className="flex items-center gap-3">
                <Layers className="h-8 w-8 text-primary/70" />
                <div>
                  <h3 className="font-semibold group-hover:text-primary transition-colors">{series.name}</h3>
                  <div className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
                    <BookOpen className="h-3.5 w-3.5" />
                    {series.bookCount} {series.bookCount === 1 ? 'book' : 'books'}
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="py-12 text-center">
          <Layers className="mx-auto h-12 w-12 text-muted-foreground" />
          <p className="mt-3 text-lg font-medium">No series found</p>
          <p className="text-sm text-muted-foreground">Series are detected from metadata or filenames during library scanning.</p>
        </div>
      )}
    </div>
  );
}
