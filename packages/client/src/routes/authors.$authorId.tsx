import { useQuery } from '@tanstack/react-query';
import { useParams, Link } from '@tanstack/react-router';
import {
  ArrowLeft,
  BookOpen,
  ExternalLink,
  Headphones,
  Layers,
  User,
} from 'lucide-react';
import { Badge } from '../components/ui/badge';
import { Separator } from '../components/ui/separator';
import { api } from '../lib/api';
import { BookCard } from '../components/books/BookCard';
import type { Book, Series } from '@npc-shelf/shared';

interface AuthorDetail {
  id: number;
  name: string;
  sortName: string;
  bio: string | null;
  photoUrl: string | null;
  hardcoverId: string | null;
  books: (Book & { role?: string; authors?: { author: { name: string } }[]; formats?: string[] })[];
  series: Series[];
}

export function AuthorDetailPage() {
  const { authorId } = useParams({ strict: false }) as { authorId: string };

  const { data: author, isLoading } = useQuery({
    queryKey: ['author', authorId],
    queryFn: () => api.get<AuthorDetail>(`/authors/${authorId}`),
    enabled: !!authorId,
  });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="h-48 animate-pulse rounded-xl bg-muted" />
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-64 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      </div>
    );
  }

  if (!author) {
    return (
      <div className="py-12 text-center">
        <User className="mx-auto h-12 w-12 text-muted-foreground" />
        <p className="mt-3 text-lg font-medium">Author not found</p>
        <Link to="/authors" className="mt-2 text-sm text-primary hover:underline">
          Back to authors
        </Link>
      </div>
    );
  }

  const authored = author.books.filter((b) => b.role === 'author');
  const narrated = author.books.filter((b) => b.role === 'narrator');
  const formatSet = new Set(author.books.flatMap((b) => b.formats || []));
  const hasAudio = formatSet.has('m4b') || formatSet.has('mp3');
  const hasEbook = formatSet.has('epub') || formatSet.has('pdf') || formatSet.has('mobi') || formatSet.has('azw3');

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Back link */}
      <Link
        to="/authors"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Authors
      </Link>

      {/* Header */}
      <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-start">
        {author.photoUrl ? (
          <img
            src={author.photoUrl}
            alt={author.name}
            className="h-28 w-28 shrink-0 rounded-full object-cover shadow-lg"
          />
        ) : (
          <div className="flex h-28 w-28 shrink-0 items-center justify-center rounded-full bg-muted shadow-lg">
            <User className="h-12 w-12 text-muted-foreground" />
          </div>
        )}
        <div className="flex-1 text-center sm:text-left">
          <h1 className="text-2xl font-bold">{author.name}</h1>
          {author.sortName !== author.name && (
            <p className="text-sm text-muted-foreground">{author.sortName}</p>
          )}

          {/* Stats */}
          <div className="mt-3 flex flex-wrap items-center justify-center gap-3 sm:justify-start">
            <Badge variant="secondary" className="gap-1">
              <BookOpen className="h-3 w-3" />
              {author.books.length} {author.books.length === 1 ? 'book' : 'books'}
            </Badge>
            {author.series.length > 0 && (
              <Badge variant="secondary" className="gap-1">
                <Layers className="h-3 w-3" />
                {author.series.length} {author.series.length === 1 ? 'series' : 'series'}
              </Badge>
            )}
            {hasEbook && (
              <Badge variant="outline" className="gap-1">
                <BookOpen className="h-3 w-3" />
                Ebooks
              </Badge>
            )}
            {hasAudio && (
              <Badge variant="outline" className="gap-1">
                <Headphones className="h-3 w-3" />
                Audiobooks
              </Badge>
            )}
          </div>

          {/* External link */}
          {author.hardcoverId && (
            <a
              href={`https://hardcover.app/authors/${author.hardcoverId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              View on Hardcover
            </a>
          )}

          {/* Bio */}
          {author.bio && (
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{author.bio}</p>
          )}
        </div>
      </div>

      <Separator />

      {/* Series */}
      {author.series.length > 0 && (
        <div>
          <h2 className="mb-3 text-lg font-semibold">Series</h2>
          <div className="flex flex-wrap gap-2">
            {author.series.map((s) => (
              <Link
                key={s.id}
                to="/series/$seriesId"
                params={{ seriesId: String(s.id) }}
                className="inline-flex items-center gap-1.5 rounded-lg border bg-card px-3 py-2 text-sm font-medium transition-colors hover:bg-muted/50"
              >
                <Layers className="h-3.5 w-3.5 text-muted-foreground" />
                {s.name}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Authored books */}
      {authored.length > 0 && (
        <div>
          <h2 className="mb-3 text-lg font-semibold">
            Books{narrated.length > 0 ? ' (Author)' : ''}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {authored.map((book) => (
              <BookCard key={book.id} book={book} />
            ))}
          </div>
        </div>
      )}

      {/* Narrated books */}
      {narrated.length > 0 && (
        <div>
          <h2 className="mb-3 text-lg font-semibold">Narrated</h2>
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {narrated.map((book) => (
              <BookCard key={book.id} book={book} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
