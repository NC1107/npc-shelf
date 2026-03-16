import { useQuery } from '@tanstack/react-query';
import { useParams, Link } from '@tanstack/react-router';
import { ArrowLeft, BookOpen, Headphones, ExternalLink } from 'lucide-react';
import { Badge } from '../components/ui/badge';
import { Progress } from '../components/ui/progress';
import { Button } from '../components/ui/button';
import { cn } from '../components/ui/utils';
import { FORMAT_COLORS } from '../lib/format-colors';
import { api } from '../lib/api';
import type { Book } from '@npc-shelf/shared';

interface SeriesBook extends Book {
  position: number | null;
  authors?: { author: { name: string } }[];
  formats?: string[];
  progressPercent?: number;
}

interface SeriesDetail {
  id: number;
  name: string;
  description: string | null;
  hardcoverId: string | null;
  books: SeriesBook[];
}

type OrderItem = { type: 'book'; book: SeriesBook } | { type: 'gap'; position: number };

function buildOrderedItems(books: SeriesBook[]): OrderItem[] {
  const positions = books
    .map((b) => b.position)
    .filter((p): p is number => p !== null)
    .sort((a, b) => a - b);
  const maxPosition = positions.length > 0 ? positions.at(-1)! : 0;
  const positionSet = new Set(positions);

  const items: OrderItem[] = [];

  if (maxPosition > 0) {
    for (let pos = 1; pos <= maxPosition; pos++) {
      const book = books.find((b) => b.position === pos);
      if (book) {
        items.push({ type: 'book', book });
      } else if (!positionSet.has(pos)) {
        items.push({ type: 'gap', position: pos });
      }
    }
    for (const book of books) {
      if (book.position === null || book.position === 0) {
        items.push({ type: 'book', book });
      }
    }
  } else {
    for (const book of books) {
      items.push({ type: 'book', book });
    }
  }

  return items;
}

function GapRow({ position }: Readonly<{ position: number }>) {
  return (
    <div
      className="flex items-center gap-4 rounded-lg border border-dashed p-4 opacity-50"
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground">
        {position}
      </div>
      <div className="h-16 w-11 shrink-0 rounded bg-muted/50" />
      <p className="text-sm italic text-muted-foreground">Book {position} — Not in library</p>
    </div>
  );
}

function BookRow({ book }: Readonly<{ book: SeriesBook }>) {
  const isAudiobook = book.audioSeconds && book.audioSeconds > 0;
  const progress = book.progressPercent;
  const fallbackIcon = isAudiobook
    ? <Headphones className="h-4 w-4 text-muted-foreground" />
    : <BookOpen className="h-4 w-4 text-muted-foreground" />;

  return (
    <Link
      to="/library/$bookId"
      params={{ bookId: String(book.id) }}
      className="group flex items-center gap-4 rounded-lg border bg-card p-4 transition-colors hover:bg-accent"
    >
      {/* Position badge */}
      {book.position ? (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
          {book.position}
        </div>
      ) : (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground">
          ?
        </div>
      )}

      {/* Cover */}
      <div className="h-16 w-11 shrink-0 overflow-hidden rounded bg-muted flex items-center justify-center">
        {book.coverPath ? (
          <img
            src={`/api/books/${book.id}/cover/thumb?v=${book.updatedAt}`}
            alt={book.title}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          fallbackIcon
        )}
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium group-hover:text-primary transition-colors">
          {book.title}
        </p>
        {book.authors && book.authors.length > 0 && (
          <p className="truncate text-sm text-muted-foreground">
            {book.authors.map((a) => a.author.name).join(', ')}
          </p>
        )}
        {progress !== undefined && progress > 0 && (
          <Progress value={progress} className="mt-1.5 h-1" />
        )}
      </div>

      {/* Format badges */}
      <div className="flex shrink-0 flex-wrap items-center gap-1">
        {book.formats?.map((fmt) => (
          <Badge
            key={fmt}
            variant="outline"
            className={cn('text-[10px] uppercase', FORMAT_COLORS[fmt])}
          >
            {fmt}
          </Badge>
        ))}
      </div>
    </Link>
  );
}

export function SeriesDetailPage() {
  const { seriesId } = useParams({ strict: false }) as { seriesId: string };

  const { data: series, isLoading } = useQuery({
    queryKey: ['series', seriesId],
    queryFn: () => api.get<SeriesDetail>(`/series/${seriesId}`),
    enabled: !!seriesId,
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-4 w-32 animate-pulse rounded bg-muted" />
        <div className="h-8 w-64 animate-pulse rounded bg-muted" />
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      </div>
    );
  }

  if (!series) {
    return <p className="text-muted-foreground">Series not found.</p>;
  }

  const books = series.books || [];
  const totalBooks = books.length;
  const booksWithProgress = books.filter((b) => b.progressPercent && b.progressPercent > 0);
  const completedBooks = books.filter((b) => b.progressPercent && b.progressPercent >= 100);
  const orderedItems = buildOrderedItems(books);

  return (
    <div className="space-y-6">
      <Link
        to="/series"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Series
      </Link>

      {/* Series header */}
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">{series.name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {totalBooks} {totalBooks === 1 ? 'book' : 'books'}
              {completedBooks.length > 0 && (
                <span> &middot; {completedBooks.length} completed</span>
              )}
            </p>
          </div>
          {series.hardcoverId && (
            <a
              href={`https://hardcover.app/series/${series.hardcoverId}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button variant="outline" size="sm">
                <ExternalLink className="h-3.5 w-3.5" />
                Hardcover
              </Button>
            </a>
          )}
        </div>

        {series.description && (
          <p className="text-sm text-muted-foreground leading-relaxed">{series.description}</p>
        )}

        {/* Reading progress bar */}
        {totalBooks > 0 && booksWithProgress.length > 0 && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Series progress</span>
              <span>{Math.round((completedBooks.length / totalBooks) * 100)}%</span>
            </div>
            <Progress value={(completedBooks.length / totalBooks) * 100} />
          </div>
        )}
      </div>

      {/* Books list — reading order */}
      {orderedItems.length > 0 ? (
        <div className="space-y-2">
          {orderedItems.map((item) =>
            item.type === 'gap' ? (
              <GapRow key={`gap-${item.position}`} position={item.position} />
            ) : (
              <BookRow key={item.book.id} book={item.book} />
            ),
          )}
        </div>
      ) : (
        <p className="py-8 text-center text-muted-foreground">
          No books found in this series.
        </p>
      )}
    </div>
  );
}
