import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, Link, useNavigate } from '@tanstack/react-router';
import {
  BookOpen, ArrowLeft, Download, Send, Play, Edit, Check, X,
  Headphones, Calendar, Globe, Hash, Building2, FileText,
  Sparkles, Loader2, Mic, ExternalLink, Music, Trash2, Merge,
  ChevronDown, ShieldCheck,
} from 'lucide-react';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Progress } from '../components/ui/progress';
import { Separator } from '../components/ui/separator';
import { api } from '../lib/api';
import type { BookDetail } from '@npc-shelf/shared';

const FORMAT_COLORS: Record<string, string> = {
  epub: 'bg-blue-600 text-white border-blue-700',
  pdf: 'bg-red-600 text-white border-red-700',
  mobi: 'bg-orange-600 text-white border-orange-700',
  azw3: 'bg-orange-600 text-white border-orange-700',
  m4b: 'bg-purple-600 text-white border-purple-700',
  mp3: 'bg-green-600 text-white border-green-700',
};

export function BookDetailPage() {
  const { bookId } = useParams({ strict: false }) as { bookId: string };
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: book, isLoading } = useQuery({
    queryKey: ['book', bookId],
    queryFn: () => api.get<BookDetail>(`/books/${bookId}`),
    enabled: !!bookId,
  });

  const sendToKindle = useMutation({
    mutationFn: () => api.post(`/kindle/send/${bookId}`),
  });

  const matchMetadata = useMutation({
    mutationFn: () => api.post(`/metadata/match/${bookId}`),
    onSuccess: () => {
      // Refetch after a delay to let the job process
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ['book', bookId] }), 3000);
    },
  });

  const deleteBook = useMutation({
    mutationFn: () => api.delete(`/books/${bookId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['books'] });
      navigate({ to: '/library' });
    },
  });

  const mergeAudiobook = useMutation({
    mutationFn: () => api.post(`/audiobooks/${bookId}/merge`),
  });

  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState<Record<string, any>>({});
  const [showFiles, setShowFiles] = useState(false);

  const saveEdit = useMutation({
    mutationFn: (data: Record<string, any>) => api.put(`/books/${bookId}`, data),
    onSuccess: () => {
      setIsEditing(false);
      setEditData({});
      queryClient.invalidateQueries({ queryKey: ['book', bookId] });
    },
  });

  function startEditing() {
    if (!book) return;
    setEditData({
      title: book.title,
      subtitle: book.subtitle || '',
      description: book.description || '',
      publisher: book.publisher || '',
      publishDate: book.publishDate || '',
      language: book.language || '',
      pageCount: book.pageCount || '',
      isbn10: book.isbn10 || '',
      isbn13: book.isbn13 || '',
    });
    setIsEditing(true);
  }

  function cancelEditing() {
    setIsEditing(false);
    setEditData({});
  }

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

          {/* File formats — summarize when many files */}
          {book.files && book.files.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {summarizeFiles(book.files).map((s) => (
                <Badge
                  key={s.label}
                  variant="outline"
                  className={FORMAT_COLORS[s.format]}
                >
                  {s.label}
                  <span className="ml-1 text-[10px] opacity-60">
                    {s.detail}
                  </span>
                </Badge>
              ))}
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 space-y-4">
          <div>
            {isEditing ? (
              <div className="space-y-2">
                <input
                  className="w-full rounded border bg-background px-3 py-2 text-3xl font-bold"
                  value={editData.title || ''}
                  onChange={(e) => setEditData({ ...editData, title: e.target.value })}
                  placeholder="Title"
                />
                <input
                  className="w-full rounded border bg-background px-3 py-1 text-lg text-muted-foreground"
                  value={editData.subtitle || ''}
                  onChange={(e) => setEditData({ ...editData, subtitle: e.target.value })}
                  placeholder="Subtitle"
                />
              </div>
            ) : (
              <>
                <h1 className="text-3xl font-bold leading-tight">{book.title}</h1>
                {book.subtitle && (
                  <p className="mt-1 text-lg text-muted-foreground">{book.subtitle}</p>
                )}
              </>
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

          {audioProgress && audioProgress.totalElapsedSeconds > 0 ? (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Listening progress</span>
                <span className="font-medium">
                  {formatDuration(audioProgress.totalElapsedSeconds)} / {formatDuration(audioProgress.totalDurationSeconds || book.audioTotalDuration)}
                </span>
              </div>
              <Progress
                value={(audioProgress.totalDurationSeconds || book.audioTotalDuration) > 0
                  ? (audioProgress.totalElapsedSeconds / (audioProgress.totalDurationSeconds || book.audioTotalDuration)) * 100
                  : 0}
              />
            </div>
          ) : book.audioTotalDuration > 0 ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Headphones className="h-4 w-4" />
              <span>Total: {formatDuration(book.audioTotalDuration)}</span>
            </div>
          ) : null}

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2">
            {hasEbook && (
              <Button
                size="lg"
                onClick={() => navigate({ to: '/library/$bookId/read', params: { bookId } })}
              >
                <BookOpen className="h-4 w-4" />
                Read
              </Button>
            )}
            {hasAudio && (
              <Button
                size="lg"
                variant="secondary"
                onClick={() => navigate({ to: '/library/$bookId/listen', params: { bookId } })}
              >
                <Play className="h-4 w-4" />
                Listen
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => window.open(`/api/books/${bookId}/file`, '_blank')}
            >
              <Download className="h-4 w-4" />
              Download
            </Button>
            {hasEbook && (
              <Button
                variant="outline"
                onClick={() => sendToKindle.mutate()}
                disabled={sendToKindle.isPending}
              >
                {sendToKindle.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                {sendToKindle.isSuccess ? 'Sent!' : sendToKindle.isError ? 'Failed' : 'Send to Kindle'}
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
              {matchMetadata.isSuccess ? 'Queued!' : matchMetadata.isError ? 'Failed' : book.hardcoverId ? 'Re-match' : 'Match Metadata'}
            </Button>
            {isEditing ? (
              <>
                <Button
                  onClick={() => saveEdit.mutate(editData)}
                  disabled={saveEdit.isPending}
                >
                  {saveEdit.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Save
                </Button>
                <Button variant="ghost" onClick={cancelEditing}>
                  <X className="h-4 w-4" />
                  Cancel
                </Button>
              </>
            ) : (
              <Button variant="ghost" onClick={startEditing}>
                <Edit className="h-4 w-4" />
                Edit
              </Button>
            )}
            {hasAudio && book.audioTrackCount > 1 && (
              <Button
                variant="outline"
                onClick={() => mergeAudiobook.mutate()}
                disabled={mergeAudiobook.isPending}
              >
                {mergeAudiobook.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Merge className="h-4 w-4" />
                )}
                {mergeAudiobook.isSuccess ? 'Queued!' : mergeAudiobook.isError ? 'Failed' : 'Merge Tracks'}
              </Button>
            )}
            <Button
              variant="destructive"
              onClick={() => {
                if (window.confirm(`Delete "${book.title}" from library?`)) {
                  deleteBook.mutate();
                }
              }}
              disabled={deleteBook.isPending}
            >
              {deleteBook.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              Delete
            </Button>
          </div>

          {/* Description */}
          {isEditing ? (
            <>
              <Separator />
              <div>
                <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Description
                </h2>
                <textarea
                  className="w-full rounded border bg-background px-3 py-2 text-sm leading-relaxed min-h-[120px]"
                  value={editData.description || ''}
                  onChange={(e) => setEditData({ ...editData, description: e.target.value })}
                  placeholder="Description"
                />
              </div>
            </>
          ) : book.description ? (
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
          ) : null}

          {/* Details grid */}
          <Separator />
          <div>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Details
            </h2>
            {isEditing ? (
              <div className="grid gap-3 text-sm sm:grid-cols-2">
                <EditField label="Publisher" value={editData.publisher || ''} onChange={(v) => setEditData({ ...editData, publisher: v })} />
                <EditField label="Published" value={editData.publishDate || ''} onChange={(v) => setEditData({ ...editData, publishDate: v })} />
                <EditField label="Language" value={editData.language || ''} onChange={(v) => setEditData({ ...editData, language: v })} />
                <EditField label="Pages" value={String(editData.pageCount || '')} onChange={(v) => setEditData({ ...editData, pageCount: v ? parseInt(v) || null : null })} />
                <EditField label="ISBN-13" value={editData.isbn13 || ''} onChange={(v) => setEditData({ ...editData, isbn13: v })} />
                <EditField label="ISBN-10" value={editData.isbn10 || ''} onChange={(v) => setEditData({ ...editData, isbn10: v })} />
              </div>
            ) : (
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
                {book.audioTotalDuration > 0 && (
                  <DetailItem icon={Headphones} label="Duration" value={formatDuration(book.audioTotalDuration)} />
                )}
                {book.authors?.filter(a => a.role === 'narrator').length > 0 && (
                  <DetailItem
                    icon={Mic}
                    label="Narrator"
                    value={book.authors.filter(a => a.role === 'narrator').map(a => a.author.name).join(', ')}
                  />
                )}
                {book.audioTrackCount > 1 && (
                  <DetailItem icon={Music} label="Tracks" value={`${book.audioTrackCount} tracks`} />
                )}
                {book.matchConfidence != null && (
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="text-muted-foreground">Match:</span>
                    <Badge
                      variant="outline"
                      className={
                        book.matchConfidence >= 0.8
                          ? 'border-green-500 text-green-700 dark:text-green-400'
                          : book.matchConfidence >= 0.5
                            ? 'border-yellow-500 text-yellow-700 dark:text-yellow-400'
                            : 'border-red-500 text-red-700 dark:text-red-400'
                      }
                    >
                      {book.matchConfidence >= 0.8 ? 'High' : book.matchConfidence >= 0.5 ? 'Medium' : 'Low'}
                      {' '}({Math.round(book.matchConfidence * 100)}%)
                    </Badge>
                  </div>
                )}
                {(book.hardcoverSlug || book.hardcoverId) && (
                  <div className="flex items-center gap-2">
                    <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="text-muted-foreground">Hardcover:</span>
                    <a
                      href={`https://hardcover.app/books/${book.hardcoverSlug || book.hardcoverId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-blue-600 hover:underline dark:text-blue-400"
                    >
                      View on Hardcover
                    </a>
                  </div>
                )}
              </div>
            )}
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

          {/* Files section */}
          {book.files && book.files.length > 0 && (
            <>
              <Separator />
              <div>
                <button
                  onClick={() => setShowFiles(!showFiles)}
                  className="flex w-full items-center justify-between mb-3"
                >
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    Files ({book.files.length})
                  </h2>
                  <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${showFiles ? 'rotate-180' : ''}`} />
                </button>
                {showFiles && (
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {book.files.map((file) => (
                      <div key={file.id} className="rounded border bg-muted/50 p-2 text-xs space-y-1">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className={FORMAT_COLORS[file.format]}>
                            {file.format.toUpperCase()}
                          </Badge>
                          <span className="font-medium truncate">{file.filename}</span>
                          <span className="ml-auto shrink-0 text-muted-foreground">{formatBytes(file.sizeBytes)}</span>
                        </div>
                        <div className="text-muted-foreground truncate">{file.path}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function EditField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground w-20 shrink-0">{label}:</span>
      <input
        className="flex-1 rounded border bg-background px-2 py-1 text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
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

function summarizeFiles(files: { id: number; format: string; sizeBytes: number }[]): { format: string; label: string; detail: string }[] {
  const groups = new Map<string, { count: number; totalSize: number }>();
  for (const f of files) {
    const existing = groups.get(f.format) || { count: 0, totalSize: 0 };
    existing.count++;
    existing.totalSize += f.sizeBytes;
    groups.set(f.format, existing);
  }

  return Array.from(groups.entries()).map(([format, { count, totalSize }]) => ({
    format,
    label: count > 1 ? `${format.toUpperCase()} ×${count}` : format.toUpperCase(),
    detail: formatBytes(totalSize),
  }));
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
