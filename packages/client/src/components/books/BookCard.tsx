import { Link } from '@tanstack/react-router';
import { BookOpen, Headphones } from 'lucide-react';
import { Badge } from '../ui/badge';
import { Progress } from '../ui/progress';
import { cn } from '../ui/utils';
import type { Book } from '@npc-shelf/shared';

const FORMAT_COLORS: Record<string, string> = {
  epub: 'bg-blue-600 text-white border-blue-700',
  pdf: 'bg-red-600 text-white border-red-700',
  mobi: 'bg-orange-600 text-white border-orange-700',
  azw3: 'bg-orange-600 text-white border-orange-700',
  m4b: 'bg-purple-600 text-white border-purple-700',
  mp3: 'bg-green-600 text-white border-green-700',
};

interface BookCardProps {
  book: Book & { authors?: { author: { name: string } }[]; formats?: string[] };
  view?: 'grid' | 'list';
}

export function BookCard({ book, view = 'grid' }: BookCardProps) {
  const isAudiobook = book.audioSeconds && book.audioSeconds > 0;
  const progress = (book as any).progressPercent as number | undefined;

  if (view === 'list') {
    return (
      <Link
        to="/library/$bookId"
        params={{ bookId: String(book.id) }}
        className="flex items-center gap-4 rounded-lg border bg-card p-3 transition-colors hover:bg-accent"
      >
        <div className="h-16 w-11 shrink-0 overflow-hidden rounded bg-muted flex items-center justify-center">
          {book.coverPath ? (
            <img
              src={`/api/books/${book.id}/cover/thumb?v=${book.updatedAt}`}
              alt={book.title}
              className="h-full w-full object-cover"
            />
          ) : isAudiobook ? (
            <Headphones className="h-4 w-4 text-muted-foreground" />
          ) : (
            <BookOpen className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{book.title}</p>
          {book.authors && book.authors.length > 0 && (
            <p className="truncate text-sm text-muted-foreground">
              {book.authors.map((a) => a.author.name).join(', ')}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {book.formats?.map((fmt) => (
            <Badge key={fmt} variant="outline" className={cn('text-[10px] uppercase', FORMAT_COLORS[fmt])}>
              {fmt}
            </Badge>
          ))}
        </div>
      </Link>
    );
  }

  return (
    <Link
      to="/library/$bookId"
      params={{ bookId: String(book.id) }}
      className="group overflow-hidden rounded-lg border bg-card transition-all hover:shadow-md"
    >
      <div className="relative aspect-[2/3] bg-muted flex items-center justify-center overflow-hidden">
        {book.coverPath ? (
          <img
            src={`/api/books/${book.id}/cover/thumb?v=${book.updatedAt}`}
            alt={book.title}
            className="h-full w-full object-cover transition-transform group-hover:scale-105"
            loading="lazy"
          />
        ) : isAudiobook ? (
          <Headphones className="h-8 w-8 text-muted-foreground" />
        ) : (
          <BookOpen className="h-8 w-8 text-muted-foreground" />
        )}

        {/* Format badges */}
        {book.formats && book.formats.length > 0 && (
          <div className="absolute bottom-1.5 left-1.5 flex gap-1">
            {book.formats.map((fmt) => (
              <span
                key={fmt}
                className={cn(
                  'rounded px-1 py-0.5 text-[10px] font-bold uppercase leading-none',
                  FORMAT_COLORS[fmt],
                )}
              >
                {fmt}
              </span>
            ))}
          </div>
        )}

        {/* Audio duration indicator */}
        {isAudiobook && (
          <div className="absolute top-1.5 right-1.5 flex items-center gap-0.5 rounded bg-black/60 px-1 py-0.5 text-[9px] text-white backdrop-blur-sm">
            <Headphones className="h-2.5 w-2.5" />
            {formatDuration(book.audioSeconds!)}
          </div>
        )}
      </div>

      <div className="p-2">
        <p className="truncate text-sm font-medium leading-tight">{book.title}</p>
        {book.authors && book.authors.length > 0 && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {book.authors.map((a) => a.author.name).join(', ')}
          </p>
        )}
        {progress !== undefined && progress > 0 && (
          <Progress value={progress} className="mt-1.5" />
        )}
      </div>
    </Link>
  );
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
