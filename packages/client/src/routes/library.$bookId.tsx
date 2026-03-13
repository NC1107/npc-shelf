import { useQuery } from '@tanstack/react-query';
import { useParams, Link } from '@tanstack/react-router';
import { BookOpen, ArrowLeft, Download, Send, Play, Edit } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { api } from '../lib/api';
import type { BookDetail } from '@npc-shelf/shared';

export function BookDetailPage() {
  const { bookId } = useParams({ strict: false }) as { bookId: string };

  const { data: book, isLoading } = useQuery({
    queryKey: ['book', bookId],
    queryFn: () => api.get<BookDetail>(`/books/${bookId}`),
    enabled: !!bookId,
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex gap-6">
          <div className="h-72 w-48 animate-pulse rounded-lg bg-muted" />
          <div className="flex-1 space-y-3">
            <div className="h-8 w-64 animate-pulse rounded bg-muted" />
            <div className="h-4 w-48 animate-pulse rounded bg-muted" />
            <div className="h-20 w-full animate-pulse rounded bg-muted" />
          </div>
        </div>
      </div>
    );
  }

  if (!book) {
    return <div className="text-muted-foreground">Book not found</div>;
  }

  const hasEbook = book.files?.some((f) => ['epub', 'pdf'].includes(f.format));
  const hasAudio = book.files?.some((f) => ['m4b', 'mp3'].includes(f.format));

  return (
    <div className="space-y-6">
      <Link to="/library" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" />
        Back to Library
      </Link>

      <div className="flex flex-col gap-6 md:flex-row">
        {/* Cover */}
        <div className="shrink-0">
          <div className="h-72 w-48 overflow-hidden rounded-lg bg-muted flex items-center justify-center shadow-md">
            {book.coverPath ? (
              <img
                src={`/api/books/${book.id}/cover/medium`}
                alt={book.title}
                className="h-full w-full object-cover"
              />
            ) : (
              <BookOpen className="h-12 w-12 text-muted-foreground" />
            )}
          </div>
        </div>

        {/* Info */}
        <div className="flex-1 space-y-4">
          <div>
            <h1 className="text-3xl font-bold">{book.title}</h1>
            {book.subtitle && (
              <p className="text-lg text-muted-foreground">{book.subtitle}</p>
            )}
          </div>

          {book.authors && book.authors.length > 0 && (
            <p className="text-muted-foreground">
              by {book.authors.map((a) => a.author.name).join(', ')}
            </p>
          )}

          {book.series && book.series.length > 0 && (
            <p className="text-sm text-muted-foreground">
              {book.series.map((s) => `${s.series.name}${s.position ? ` #${s.position}` : ''}`).join(', ')}
            </p>
          )}

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2">
            {hasEbook && (
              <Button>
                <BookOpen className="h-4 w-4" />
                Read
              </Button>
            )}
            {hasAudio && (
              <Button variant="secondary">
                <Play className="h-4 w-4" />
                Listen
              </Button>
            )}
            <Button variant="outline">
              <Download className="h-4 w-4" />
              Download
            </Button>
            <Button variant="outline">
              <Send className="h-4 w-4" />
              Send to Kindle
            </Button>
            <Button variant="ghost">
              <Edit className="h-4 w-4" />
              Edit Metadata
            </Button>
          </div>

          {/* Description */}
          {book.description && (
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <p>{book.description}</p>
            </div>
          )}

          {/* Details */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Details</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
              {book.publisher && (
                <div>
                  <span className="text-muted-foreground">Publisher:</span> {book.publisher}
                </div>
              )}
              {book.publishDate && (
                <div>
                  <span className="text-muted-foreground">Published:</span> {book.publishDate}
                </div>
              )}
              {book.language && (
                <div>
                  <span className="text-muted-foreground">Language:</span> {book.language}
                </div>
              )}
              {book.pageCount && (
                <div>
                  <span className="text-muted-foreground">Pages:</span> {book.pageCount}
                </div>
              )}
              {book.isbn13 && (
                <div>
                  <span className="text-muted-foreground">ISBN:</span> {book.isbn13}
                </div>
              )}
              {book.files && book.files.length > 0 && (
                <div>
                  <span className="text-muted-foreground">Formats:</span>{' '}
                  {book.files.map((f) => f.format.toUpperCase()).join(', ')}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Tags */}
          {book.tags && book.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {book.tags.map((tag) => (
                <span
                  key={tag.id}
                  className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground"
                >
                  {tag.name}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
