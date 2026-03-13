import { useQuery } from '@tanstack/react-query';
import { useParams, Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { BookCard } from '../components/books/BookCard';
import { api } from '../lib/api';

export function SeriesDetailPage() {
  const { seriesId } = useParams({ strict: false }) as { seriesId: string };

  const { data: series, isLoading } = useQuery({
    queryKey: ['series', seriesId],
    queryFn: () => api.get<any>(`/series/${seriesId}`),
    enabled: !!seriesId,
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-4 w-32 animate-pulse rounded bg-muted" />
        <div className="h-8 w-64 animate-pulse rounded bg-muted" />
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-72 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      </div>
    );
  }

  if (!series) {
    return <p className="text-muted-foreground">Series not found.</p>;
  }

  return (
    <div className="space-y-6">
      <Link
        to="/series"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Series
      </Link>

      <div>
        <h1 className="text-2xl font-bold">{series.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {series.books?.length || 0} {series.books?.length === 1 ? 'book' : 'books'}
        </p>
      </div>

      {series.books && series.books.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {series.books.map((book: any) => (
            <div key={book.id} className="relative">
              {book.position && (
                <div className="absolute left-2 top-2 z-10 rounded-full bg-primary px-2 py-0.5 text-xs font-bold text-primary-foreground">
                  #{book.position}
                </div>
              )}
              <BookCard book={book} />
            </div>
          ))}
        </div>
      ) : (
        <p className="py-8 text-center text-muted-foreground">
          No books found in this series.
        </p>
      )}
    </div>
  );
}
