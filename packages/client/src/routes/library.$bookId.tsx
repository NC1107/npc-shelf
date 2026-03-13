import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, Link } from '@tanstack/react-router';
import {
  BookOpen, ArrowLeft, Download, Send, Play, Edit,
  Headphones, Calendar, Globe, Hash, Building2, FileText,
  Sparkles, Loader2,
} from 'lucide-react';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Progress } from '../components/ui/progress';
import { Separator } from '../components/ui/separator';
import { api } from '../lib/api';
import type { BookDetail } from '@npc-shelf/shared';

const FORMAT_COLORS: Record<string, string> = {
  epub: 'bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/20',
  pdf: 'bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/20',
  mobi: 'bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/20',
  azw3: 'bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/20',
  m4b: 'bg-purple-500/15 text-purple-700 dark:text-purple-400 border-purple-500/20',
  mp3: 'bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/20',
};

export function BookDetailPage() {
  const { bookId } = useParams({ strict: false }) as { bookId: string };

  const queryClient = useQueryClient();

  const { data: book, isLoading } = useQuery({
    queryKey: ['book', bookId],
    queryFn: () => api.get<BookDetail>(`/books/${bookId}`),
    enabled: !!bookId,
  });

  const matchMetadata = useMutation({
    mutationFn: () => api.post(`/metadata/match/${bookId}`),
    onSuccess: () => {
      // Refetch after a delay to let the job process
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ['book', bookId] }), 3000);
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-4 w-32 animate-pulse rounded bg-muted" />
        <div className="flex flex-col gap-6 md:flex-row">
          <div className="h-80 w-52 shrink-0 animate-pulse rounded-lg bg-muted" />
          <div className="flex-1 space-y-3">
            <div className="h-8 w-64 animate-pulse rounded bg-muted" />
            <div className="h-4 w-48 animate-pulse rounded bg-muted" />
            <div className="h-4 w-32 animate-pulse rounded bg-muted" />
            <div className="h-24 w-full animate-pulse rounded bg-muted" />
          </div>
        </div>
      </div>
    );
  }

  if (!book) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <BookOpen className="h-16 w-16 text-muted-foreground mb-4" />
        <p className="text-lg font-medium">Book not found</p>
        <Link to="/library" className="mt-2 text-sm text-muted-foreground hover:text-foreground">
          Back to Library
        </Link>
      </div>
    );
  }

  const hasEbook = book.files?.some((f) => ['epub', 'pdf'].includes(f.format));
  const hasAudio = book.files?.some((f) => ['m4b', 'mp3'].includes(f.format));
  const readingProgress = book.readingProgress;
  const audioProgress = book.audioProgress;

  return (
    <div className="space-y-6">
      <Link
        to="/library"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Library
      </Link>

      <div className="flex flex-col gap-6 md:flex-row">
        {/* Cover */}
        <div className="shrink-0">
          <div className="h-80 w-52 overflow-hidden rounded-lg bg-muted flex items-center justify-center shadow-lg">
            {book.coverPath ? (
              <img
                src={`/api/books/${book.id}/cover/medium`}
                alt={book.title}
                className="h-full w-full object-cover"
              />
            ) : hasAudio ? (
              <Headphones className="h-16 w-16 text-muted-foreground" />
            ) : (
              <BookOpen className="h-16 w-16 text-muted-foreground" />
            )}
          </div>

          {/* File formats */}
          {book.files && book.files.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {book.files.map((f) => (
                <Badge
                  key={f.id}
                  variant="outline"
                  className={FORMAT_COLORS[f.format]}
                >
                  {f.format.toUpperCase()}
                  <span className="ml-1 text-[10px] opacity-60">
                    {formatBytes(f.sizeBytes)}
                  </span>
                </Badge>
              ))}
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 space-y-4">
          <div>
            <h1 className="text-3xl font-bold leading-tight">{book.title}</h1>
            {book.subtitle && (
              <p className="mt-1 text-lg text-muted-foreground">{book.subtitle}</p>
            )}
          </div>

          {book.authors && book.authors.length > 0 && (
            <p className="text-lg text-muted-foreground">
              by{' '}
              {book.authors.map((a, i) => (
                <span key={a.author.id || i}>
                  {i > 0 && ', '}
                  <span className="font-medium text-foreground">{a.author.name}</span>
                  {a.role !== 'author' && (
                    <span className="text-sm"> ({a.role})</span>
                  )}
                </span>
              ))}
            </p>
          )}

          {book.series && book.series.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {book.series.map((s) => (
                <Badge key={s.series.id || s.series.name} variant="secondary">
                  {s.series.name}
                  {s.position && <span className="ml-1 opacity-70">#{s.position}</span>}
                </Badge>
              ))}
            </div>
          )}

          {/* Progress */}
          {readingProgress && readingProgress.progressPercent > 0 && (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Reading progress</span>
                <span className="font-medium">{Math.round(readingProgress.progressPercent * 100)}%</span>
              </div>
              <Progress value={readingProgress.progressPercent * 100} />
            </div>
          )}

          {audioProgress && audioProgress.totalElapsedSeconds > 0 && (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Listening progress</span>
                <span className="font-medium">
                  {formatDuration(audioProgress.totalElapsedSeconds)} / {formatDuration(audioProgress.totalDurationSeconds)}
                </span>
              </div>
              <Progress
                value={audioProgress.totalDurationSeconds > 0
                  ? (audioProgress.totalElapsedSeconds / audioProgress.totalDurationSeconds) * 100
                  : 0}
              />
            </div>
          )}

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2">
            {hasEbook && (
              <Button size="lg">
                <BookOpen className="h-4 w-4" />
                Read
              </Button>
            )}
            {hasAudio && (
              <Button size="lg" variant="secondary">
                <Play className="h-4 w-4" />
                Listen
              </Button>
            )}
            <Button variant="outline">
              <Download className="h-4 w-4" />
              Download
            </Button>
            {hasEbook && (
              <Button variant="outline">
                <Send className="h-4 w-4" />
                Send to Kindle
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => matchMetadata.mutate()}
              disabled={matchMetadata.isPending}
            >
              {matchMetadata.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {book.hardcoverId ? 'Re-match' : 'Match Metadata'}
            </Button>
            <Button variant="ghost">
              <Edit className="h-4 w-4" />
              Edit
            </Button>
          </div>

          {/* Description */}
          {book.description && (
            <>
              <Separator />
              <div>
                <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Description
                </h2>
                <div className="prose prose-sm dark:prose-invert max-w-none leading-relaxed">
                  <p>{book.description}</p>
                </div>
              </div>
            </>
          )}

          {/* Details grid */}
          <Separator />
          <div>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Details
            </h2>
            <div className="grid gap-3 text-sm sm:grid-cols-2">
              {book.publisher && (
                <DetailItem icon={Building2} label="Publisher" value={book.publisher} />
              )}
              {book.publishDate && (
                <DetailItem icon={Calendar} label="Published" value={book.publishDate} />
              )}
              {book.language && (
                <DetailItem icon={Globe} label="Language" value={book.language.toUpperCase()} />
              )}
              {book.pageCount && (
                <DetailItem icon={FileText} label="Pages" value={String(book.pageCount)} />
              )}
              {book.isbn13 && (
                <DetailItem icon={Hash} label="ISBN-13" value={book.isbn13} />
              )}
              {book.isbn10 && (
                <DetailItem icon={Hash} label="ISBN-10" value={book.isbn10} />
              )}
              {book.audioSeconds && book.audioSeconds > 0 && (
                <DetailItem icon={Headphones} label="Duration" value={formatDuration(book.audioSeconds)} />
              )}
            </div>
          </div>

          {/* Tags */}
          {book.tags && book.tags.length > 0 && (
            <>
              <Separator />
              <div>
                <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Tags
                </h2>
                <div className="flex flex-wrap gap-1.5">
                  {book.tags.map((tag) => (
                    <Badge key={tag.id} variant="secondary">
                      {tag.name}
                    </Badge>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function DetailItem({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
