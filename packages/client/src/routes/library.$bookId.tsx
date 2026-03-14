import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, Link, useNavigate } from '@tanstack/react-router';
import {
  BookOpen, ArrowLeft, Download, Send, Play, Edit, Check, X,
  Headphones, Calendar, Globe, Hash, Building2, FileText,
  Sparkles, Loader2, Mic, ExternalLink, Music, Trash2, Merge,
  ChevronDown, ShieldCheck, Wrench, AlertCircle, CheckCircle2, Scissors, RotateCcw, Upload,
  FolderSync, PenLine, RefreshCw, Save,
} from 'lucide-react';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Progress } from '../components/ui/progress';
import { Separator } from '../components/ui/separator';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '../components/ui/tooltip';
import { DropdownMenu, DropdownTrigger, DropdownContent, DropdownItem } from '../components/ui/dropdown-menu';
import { api } from '../lib/api';
import { FORMAT_COLORS } from '../lib/format-colors';
import type { BookDetail, MatchBreakdown } from '@npc-shelf/shared';

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
    onSuccess: () => setMergePolling(true),
  });

  const [mergePolling, setMergePolling] = useState(false);

  const { data: bookJobs } = useQuery({
    queryKey: ['jobs', 'book', bookId],
    queryFn: () => api.get<any[]>(`/jobs/book/${bookId}`),
    enabled: mergePolling,
    refetchInterval: 2000,
  });

  // Derive merge job status from polled jobs
  const mergeJob = bookJobs?.find((j: any) => j.jobType === 'merge_audiobook');
  const mergeStatus = mergeJob?.status as string | undefined;

  // Stop polling and refresh book data when merge completes or fails
  useEffect(() => {
    if (!mergePolling || !mergeStatus) return;
    if (mergeStatus === 'completed' || mergeStatus === 'failed') {
      setMergePolling(false);
      if (mergeStatus === 'completed') {
        queryClient.invalidateQueries({ queryKey: ['book', bookId] });
      }
    }
  }, [mergePolling, mergeStatus, bookId, queryClient]);

  const uploadCover = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('cover', file);
      const res = await fetch(`/api/books/${bookId}/cover`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: form,
      });
      if (!res.ok) throw new Error((await res.json()).error);
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['book', bookId] }),
  });

  const splitFiles = useMutation({
    mutationFn: (fileIds: number[]) => api.post(`/books/${bookId}/split`, { fileIds }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['book', bookId] });
      queryClient.invalidateQueries({ queryKey: ['books'] });
      setSplitMode(false);
      setSelectedFileIds(new Set());
    },
  });

  const clearMatch = useMutation({
    mutationFn: () => api.delete(`/books/${bookId}/match`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['book', bookId] }),
  });

  const [renamePreview, setRenamePreview] = useState<any[] | null>(null);

  const previewRename = useMutation({
    mutationFn: () => api.post(`/books/${bookId}/rename/preview`),
    onSuccess: (data: any) => setRenamePreview(data),
  });

  const executeRename = useMutation({
    mutationFn: () => api.post(`/books/${bookId}/rename/execute`),
    onSuccess: () => {
      setRenamePreview(null);
      queryClient.invalidateQueries({ queryKey: ['book', bookId] });
    },
  });

  const writeMetadata = useMutation({
    mutationFn: () => api.post(`/books/${bookId}/write-metadata`),
  });

  const convertFormat = useMutation({
    mutationFn: (data: { fileId: number; targetFormat: string }) =>
      api.post(`/books/${bookId}/convert`, data),
  });

  const { data: chapters } = useQuery({
    queryKey: ['chapters', bookId],
    queryFn: () => api.get<any[]>(`/audiobooks/${bookId}/chapters`),
    enabled: !!book?.hasAudio,
  });

  const [editingChapters, setEditingChapters] = useState(false);
  const [chapterData, setChapterData] = useState<any[]>([]);

  const saveChapters = useMutation({
    mutationFn: (data: any[]) => api.put(`/audiobooks/${bookId}/chapters`, { chapters: data }),
    onSuccess: () => {
      setEditingChapters(false);
      queryClient.invalidateQueries({ queryKey: ['chapters', bookId] });
    },
  });

  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState<Record<string, any>>({});
  const [showFiles, setShowFiles] = useState(false);
  const [splitMode, setSplitMode] = useState(false);
  const [selectedFileIds, setSelectedFileIds] = useState<Set<number>>(new Set());

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
      authors: book.authors?.map((a: any) => ({ name: a.author.name, role: a.role })) || [{ name: '', role: 'author' }],
      series: book.series?.map((s: any) => ({ name: s.series.name, position: s.position })) || [],
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

  const hasEbook = book.hasEbook ?? book.files?.some((f) => ['epub', 'pdf'].includes(f.format));
  const hasAudio = book.hasAudio ?? book.files?.some((f) => ['m4b', 'mp3'].includes(f.format));
  const hasBothFormats = hasEbook && hasAudio;
  const readingProgress = book.readingProgress;
  const audioProgress = book.audioProgress;

  return (
    <BookDetailContent
      book={book}
      bookId={bookId}
      hasEbook={!!hasEbook}
      hasAudio={!!hasAudio}
      hasBothFormats={!!hasBothFormats}
      readingProgress={readingProgress}
      audioProgress={audioProgress}
      isEditing={isEditing}
      editData={editData}
      setEditData={setEditData}
      showFiles={showFiles}
      setShowFiles={setShowFiles}
      navigate={navigate}
      startEditing={startEditing}
      cancelEditing={cancelEditing}
      saveEdit={saveEdit}
      sendToKindle={sendToKindle}
      matchMetadata={matchMetadata}
      deleteBook={deleteBook}
      mergeAudiobook={mergeAudiobook}
      mergeJob={mergeJob}
      uploadCover={uploadCover}
      splitFiles={splitFiles}
      clearMatch={clearMatch}
      previewRename={previewRename}
      executeRename={executeRename}
      writeMetadata={writeMetadata}
      renamePreview={renamePreview}
      setRenamePreview={setRenamePreview}
      splitMode={splitMode}
      setSplitMode={setSplitMode}
      selectedFileIds={selectedFileIds}
      setSelectedFileIds={setSelectedFileIds}
      convertFormat={convertFormat}
      chapters={chapters}
      editingChapters={editingChapters}
      setEditingChapters={setEditingChapters}
      chapterData={chapterData}
      setChapterData={setChapterData}
      saveChapters={saveChapters}
    />
  );
}

function BookDetailContent({
  book, bookId, hasEbook, hasAudio, hasBothFormats,
  readingProgress, audioProgress,
  isEditing, editData, setEditData, showFiles, setShowFiles,
  navigate, startEditing, cancelEditing, saveEdit,
  sendToKindle, matchMetadata, deleteBook, mergeAudiobook, mergeJob, uploadCover,
  splitFiles, clearMatch, previewRename, executeRename, writeMetadata, renamePreview, setRenamePreview,
  splitMode, setSplitMode, selectedFileIds, setSelectedFileIds,
  convertFormat, chapters, editingChapters, setEditingChapters, chapterData, setChapterData, saveChapters,
}: any) {
  const [activeFormat, setActiveFormat] = useState<'ebook' | 'audiobook'>(hasAudio ? 'audiobook' : 'ebook');

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
          <label className="group relative block h-80 w-52 cursor-pointer overflow-hidden rounded-lg bg-muted shadow-lg">
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) uploadCover.mutate(file);
                e.target.value = '';
              }}
            />
            <div className="flex h-full w-full items-center justify-center">
              {book.coverPath ? (
                <img
                  src={`/api/books/${book.id}/cover/medium?v=${book.updatedAt}`}
                  alt={book.title}
                  className="h-full w-full object-cover"
                />
              ) : hasAudio ? (
                <Headphones className="h-16 w-16 text-muted-foreground" aria-hidden="true" />
              ) : (
                <BookOpen className="h-16 w-16 text-muted-foreground" aria-hidden="true" />
              )}
            </div>
            <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
              {uploadCover.isPending ? (
                <Loader2 className="h-8 w-8 animate-spin text-white" />
              ) : (
                <Upload className="h-8 w-8 text-white" />
              )}
            </div>
          </label>

          {/* File formats */}
          {book.files && book.files.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {summarizeFiles(book.files).map((s: any) => (
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

          {isEditing ? (
            <div className="space-y-1">
              <span className="text-sm text-muted-foreground">Authors</span>
              {(editData.authors || []).map((a: any, i: number) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    className="flex-1 rounded border bg-background px-2 py-1 text-sm"
                    value={a.name}
                    onChange={(e) => {
                      const next = [...editData.authors];
                      next[i] = { ...next[i], name: e.target.value };
                      setEditData({ ...editData, authors: next });
                    }}
                    placeholder="Author name"
                  />
                  <select
                    className="rounded border bg-background px-2 py-1 text-sm"
                    value={a.role}
                    onChange={(e) => {
                      const next = [...editData.authors];
                      next[i] = { ...next[i], role: e.target.value };
                      setEditData({ ...editData, authors: next });
                    }}
                  >
                    <option value="author">Author</option>
                    <option value="narrator">Narrator</option>
                    <option value="editor">Editor</option>
                  </select>
                  <button
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => {
                      const next = editData.authors.filter((_: any, j: number) => j !== i);
                      setEditData({ ...editData, authors: next });
                    }}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
              <button
                className="text-sm text-muted-foreground hover:text-foreground"
                onClick={() => setEditData({ ...editData, authors: [...(editData.authors || []), { name: '', role: 'author' }] })}
              >
                + Add author
              </button>
            </div>
          ) : book.authors && book.authors.length > 0 ? (
            <div className="flex items-center gap-3">
              {book.authors.some((a: any) => a.author.photoUrl) && (
                <div className="flex -space-x-2">
                  {book.authors.filter((a: any) => a.author.photoUrl).map((a: any) => (
                    <img
                      key={a.author.id}
                      src={a.author.photoUrl}
                      alt={a.author.name}
                      className="h-8 w-8 rounded-full border-2 border-background object-cover"
                    />
                  ))}
                </div>
              )}
              <p className="text-lg text-muted-foreground">
                by{' '}
                {book.authors.map((a: any, i: number) => (
                  <span key={a.author.id || i}>
                    {i > 0 && ', '}
                    <Link
                      to="/library"
                      search={{ authorId: String(a.author.id) }}
                      className="font-medium text-foreground hover:underline"
                    >
                      {a.author.name}
                    </Link>
                    {a.role !== 'author' && (
                      <span className="text-sm"> ({a.role})</span>
                    )}
                  </span>
                ))}
              </p>
            </div>
          ) : null}

          {isEditing ? (
            <div className="space-y-1">
              <span className="text-sm text-muted-foreground">Series</span>
              {(editData.series || []).map((s: any, i: number) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    className="flex-1 rounded border bg-background px-2 py-1 text-sm"
                    value={s.name}
                    onChange={(e) => {
                      const next = [...editData.series];
                      next[i] = { ...next[i], name: e.target.value };
                      setEditData({ ...editData, series: next });
                    }}
                    placeholder="Series name"
                  />
                  <input
                    className="w-16 rounded border bg-background px-2 py-1 text-sm"
                    type="number"
                    value={s.position ?? ''}
                    onChange={(e) => {
                      const next = [...editData.series];
                      next[i] = { ...next[i], position: e.target.value ? parseFloat(e.target.value) : null };
                      setEditData({ ...editData, series: next });
                    }}
                    placeholder="#"
                  />
                  <button
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => {
                      const next = editData.series.filter((_: any, j: number) => j !== i);
                      setEditData({ ...editData, series: next });
                    }}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
              <button
                className="text-sm text-muted-foreground hover:text-foreground"
                onClick={() => setEditData({ ...editData, series: [...(editData.series || []), { name: '', position: null }] })}
              >
                + Add series
              </button>
            </div>
          ) : book.series && book.series.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {book.series.map((s: any) => (
                <Badge key={s.series.id || s.series.name} variant="secondary">
                  {s.series.name}
                  {s.position && <span className="ml-1 opacity-70">#{s.position}</span>}
                </Badge>
              ))}
            </div>
          ) : null}

          {/* Progress */}
          {(!hasBothFormats || activeFormat === 'ebook') && readingProgress && readingProgress.progressPercent > 0 && (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Reading progress</span>
                <span className="font-medium">{Math.round(readingProgress.progressPercent * 100)}%</span>
              </div>
              <Progress value={readingProgress.progressPercent * 100} />
            </div>
          )}

          {(!hasBothFormats || activeFormat === 'audiobook') && audioProgress && audioProgress.totalElapsedSeconds > 0 ? (
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
          ) : (!hasBothFormats || activeFormat === 'audiobook') && book.audioTotalDuration > 0 ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Headphones className="h-4 w-4" />
              <span>Total: {formatDuration(book.audioTotalDuration)}</span>
            </div>
          ) : null}

          {/* Action buttons — always visible */}
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
            {/* Tools dropdown */}
            {book.files && book.files.length > 0 && (
              <DropdownMenu>
                <DropdownTrigger>
                  <Button variant="outline">
                    <Wrench className="h-4 w-4" />
                    Tools
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                </DropdownTrigger>
                <DropdownContent>
                  {hasAudio && book.audioTrackCount > 1 && (
                    <DropdownItem
                      onClick={() => mergeAudiobook.mutate()}
                      disabled={mergeAudiobook.isPending || mergeJob?.status === 'pending' || mergeJob?.status === 'processing'}
                    >
                      {mergeAudiobook.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Merge className="h-4 w-4" />
                      )}
                      {mergeAudiobook.isSuccess ? 'Queued!' : 'Merge Audio Tracks'}
                    </DropdownItem>
                  )}
                  {book.files && book.files.length > 1 && (
                    <DropdownItem
                      onClick={() => { setSplitMode(true); setShowFiles(true); }}
                    >
                      <Scissors className="h-4 w-4" />
                      Split Files into New Book
                    </DropdownItem>
                  )}
                  <DropdownItem
                    onClick={() => previewRename.mutate()}
                    disabled={previewRename.isPending}
                  >
                    <FolderSync className="h-4 w-4" />
                    {previewRename.isPending ? 'Loading...' : 'Rename Files'}
                  </DropdownItem>
                  <DropdownItem
                    onClick={() => writeMetadata.mutate()}
                    disabled={writeMetadata.isPending}
                  >
                    <PenLine className="h-4 w-4" />
                    {writeMetadata.isPending ? 'Writing...' : writeMetadata.isSuccess ? 'Done!' : 'Write Metadata to Files'}
                  </DropdownItem>
                  {book.files?.some((f: any) => ['epub', 'mobi', 'azw3', 'pdf'].includes(f.format)) && (
                    <DropdownItem
                      onClick={() => {
                        const file = book.files.find((f: any) => ['epub', 'mobi', 'azw3', 'pdf'].includes(f.format));
                        if (!file) return;
                        const conversions: Record<string, string[]> = {
                          epub: ['mobi', 'azw3', 'pdf'], mobi: ['epub'], azw3: ['epub'], pdf: ['epub'],
                        };
                        const targets = conversions[file.format] || [];
                        const target = targets[0];
                        if (target) convertFormat.mutate({ fileId: file.id, targetFormat: target });
                      }}
                      disabled={convertFormat.isPending}
                    >
                      <RefreshCw className="h-4 w-4" />
                      {convertFormat.isPending ? 'Converting...' : convertFormat.isSuccess ? 'Queued!' : 'Convert Format'}
                    </DropdownItem>
                  )}
                  {book.hardcoverId && (
                    <DropdownItem
                      onClick={() => clearMatch.mutate()}
                      disabled={clearMatch.isPending}
                    >
                      <RotateCcw className="h-4 w-4" />
                      {clearMatch.isSuccess ? 'Cleared!' : 'Clear Metadata Match'}
                    </DropdownItem>
                  )}
                </DropdownContent>
              </DropdownMenu>
            )}
            {/* Merge job status banner */}
            {mergeJob && (mergeJob.status === 'pending' || mergeJob.status === 'processing') && (
              <div className="flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300">
                <Loader2 className="h-4 w-4 animate-spin" />
                {mergeJob.status === 'pending' ? 'Merge queued...' : 'Merging audio tracks...'}
              </div>
            )}
            {mergeJob?.status === 'completed' && (
              <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-1.5 text-sm text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-300">
                <CheckCircle2 className="h-4 w-4" />
                Merge complete!
              </div>
            )}
            {mergeJob?.status === 'failed' && (
              <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
                <AlertCircle className="h-4 w-4" />
                Merge failed{mergeJob.error ? `: ${mergeJob.error}` : ''}
              </div>
            )}
            {writeMetadata.isSuccess && (
              <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-1.5 text-sm text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-300">
                <CheckCircle2 className="h-4 w-4" />
                Metadata written to files
              </div>
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

          {/* Format toggle — only controls progress/description display below */}
          {hasBothFormats && (
            <div className="flex rounded-lg border p-0.5 gap-0.5 w-fit">
              <button
                onClick={() => setActiveFormat('ebook')}
                aria-pressed={activeFormat === 'ebook'}
                className={`px-3 py-1 rounded text-sm transition-colors ${
                  activeFormat === 'ebook'
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-muted'
                }`}
              >
                <BookOpen className="h-3.5 w-3.5 inline mr-1" /> Ebook
              </button>
              <button
                onClick={() => setActiveFormat('audiobook')}
                aria-pressed={activeFormat === 'audiobook'}
                className={`px-3 py-1 rounded text-sm transition-colors ${
                  activeFormat === 'audiobook'
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-muted'
                }`}
              >
                <Headphones className="h-3.5 w-3.5 inline mr-1" /> Audiobook
              </button>
            </div>
          )}

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
                {book.authors?.filter((a: any) => a.role === 'narrator').length > 0 && (
                  <DetailItem
                    icon={Mic}
                    label="Narrator"
                    value={book.authors.filter((a: any) => a.role === 'narrator').map((a: any) => a.author.name).join(', ')}
                  />
                )}
                {book.audioTrackCount > 1 && (
                  <DetailItem icon={Music} label="Tracks" value={`${book.audioTrackCount} tracks`} />
                )}
                {book.matchConfidence != null && (
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="text-muted-foreground">Match:</span>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Badge
                            variant="outline"
                            className={`cursor-help ${
                              book.matchConfidence >= 0.8
                                ? 'border-green-500 text-green-700 dark:text-green-400'
                                : book.matchConfidence >= 0.5
                                  ? 'border-yellow-500 text-yellow-700 dark:text-yellow-400'
                                  : 'border-red-500 text-red-700 dark:text-red-400'
                            }`}
                          >
                            {book.matchConfidence >= 0.8 ? 'High' : book.matchConfidence >= 0.5 ? 'Medium' : 'Low'}
                            {' '}({Math.round(book.matchConfidence * 100)}%)
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="max-w-xs">
                          <MatchBreakdownTooltip breakdown={book.matchBreakdown} confidence={book.matchConfidence} />
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
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
                  {book.tags.map((tag: any) => (
                    <Badge key={tag.id} variant="secondary">
                      {tag.name}
                    </Badge>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Chapters section (audiobooks) */}
          {hasAudio && chapters && chapters.length > 0 && (
            <>
              <Separator />
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    Chapters ({chapters.length})
                  </h2>
                  {editingChapters ? (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => saveChapters.mutate(chapterData)}
                        disabled={saveChapters.isPending}
                      >
                        {saveChapters.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                        Save
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingChapters(false)}>
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setChapterData(chapters.map((c: any) => ({ ...c })));
                        setEditingChapters(true);
                      }}
                    >
                      <Edit className="h-3 w-3" />
                      Edit
                    </Button>
                  )}
                </div>
                <div className="space-y-1 max-h-64 overflow-y-auto">
                  {(editingChapters ? chapterData : chapters).map((ch: any, i: number) => (
                    <div key={ch.id || i} className="flex items-center gap-2 rounded border bg-muted/50 px-2 py-1.5 text-xs">
                      <span className="w-8 shrink-0 text-muted-foreground text-right">{i + 1}.</span>
                      {editingChapters ? (
                        <input
                          className="flex-1 rounded border bg-background px-2 py-0.5 text-xs"
                          value={ch.title}
                          onChange={(e) => {
                            const next = [...chapterData];
                            next[i] = { ...next[i], title: e.target.value };
                            setChapterData(next);
                          }}
                        />
                      ) : (
                        <span className="flex-1 truncate">{ch.title}</span>
                      )}
                      <span className="shrink-0 text-muted-foreground">
                        {formatChapterTime(ch.startTime)} - {formatChapterTime(ch.endTime)}
                      </span>
                    </div>
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
                  <>
                    {splitMode && (
                      <div className="mb-2 flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">Select files to split into a new book:</span>
                        <Button
                          size="sm"
                          disabled={selectedFileIds.size === 0 || selectedFileIds.size >= book.files.length || splitFiles.isPending}
                          onClick={() => splitFiles.mutate([...selectedFileIds])}
                        >
                          {splitFiles.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Scissors className="h-3 w-3" />}
                          Split ({selectedFileIds.size})
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => { setSplitMode(false); setSelectedFileIds(new Set()); }}>
                          Cancel
                        </Button>
                      </div>
                    )}
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {book.files.map((file: any) => (
                        <div
                          key={file.id}
                          className={`rounded border bg-muted/50 p-2 text-xs space-y-1 ${splitMode ? 'cursor-pointer hover:border-primary' : ''} ${selectedFileIds.has(file.id) ? 'border-primary bg-primary/5' : ''}`}
                          onClick={splitMode ? () => {
                            const next = new Set(selectedFileIds);
                            if (next.has(file.id)) next.delete(file.id); else next.add(file.id);
                            setSelectedFileIds(next);
                          } : undefined}
                        >
                          <div className="flex items-center gap-2">
                            {splitMode && (
                              <input
                                type="checkbox"
                                checked={selectedFileIds.has(file.id)}
                                readOnly
                                className="h-3.5 w-3.5"
                              />
                            )}
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
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Rename preview diff */}
      {renamePreview && (
        <div className="rounded-lg border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Rename Preview</h3>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => executeRename.mutate()}
                disabled={executeRename.isPending || !renamePreview.some((p: any) => p.status === 'rename')}
              >
                {executeRename.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <FolderSync className="h-3 w-3" />}
                Apply
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setRenamePreview(null)}>Cancel</Button>
            </div>
          </div>
          <div className="space-y-2 text-xs">
            {renamePreview.map((p: any) => (
              <div key={p.fileId} className={`rounded border p-2 ${p.status === 'rename' ? 'border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950' : p.status === 'conflict' ? 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950' : 'border-muted bg-muted/30'}`}>
                <div className="text-muted-foreground line-through">{p.currentPath}</div>
                <div className={p.status === 'rename' ? 'text-blue-700 dark:text-blue-300 font-medium' : p.status === 'conflict' ? 'text-red-700 dark:text-red-300' : 'text-muted-foreground'}>
                  {p.status === 'conflict' ? `CONFLICT: ${p.newPath}` : p.status === 'unchanged' ? '(unchanged)' : p.newPath}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MatchBreakdownTooltip({ breakdown, confidence }: { breakdown: MatchBreakdown | null; confidence: number }) {
  if (!breakdown) {
    return <span>Match confidence: {Math.round(confidence * 100)}%</span>;
  }

  const titleContrib = breakdown.titleSimilarity * breakdown.titleWeight;
  const authorContrib = breakdown.authorSimilarity * breakdown.authorWeight;

  return (
    <div className="space-y-1.5 text-xs">
      <div className="font-semibold">Match Breakdown</div>
      <div>
        Title: {Math.round(breakdown.titleSimilarity * 100)}%
        {breakdown.titleWeight > 0 && (
          <span className="opacity-70"> ({'\u00D7'}{breakdown.titleWeight} = {Math.round(titleContrib * 100)}%)</span>
        )}
      </div>
      {breakdown.authorWeight > 0 && (
        <div>
          Author: {Math.round(breakdown.authorSimilarity * 100)}%
          <span className="opacity-70"> ({'\u00D7'}{breakdown.authorWeight} = {Math.round(authorContrib * 100)}%)</span>
        </div>
      )}
      <div className="font-semibold">Total: {Math.round(confidence * 100)}%</div>
      <Separator />
      <div className="opacity-70">
        <div>Local: "{breakdown.localTitle}"</div>
        <div>Matched: "{breakdown.matchedTitle}"</div>
        {breakdown.localAuthor && <div>Local author: "{breakdown.localAuthor}"</div>}
        {breakdown.matchedAuthor && <div>Matched author: "{breakdown.matchedAuthor}"</div>}
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
    label: count > 1 ? `${format.toUpperCase()} \u00D7${count}` : format.toUpperCase(),
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

function formatChapterTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}
