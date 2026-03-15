import { useState, useCallback, useRef } from 'react';
import { useParams, Link } from '@tanstack/react-router';
import { useQuery, useMutation } from '@tanstack/react-query';
import { ArrowLeft, Settings, Maximize, Minimize } from 'lucide-react';
import { Button } from '../components/ui/button';
import { EpubReader } from '../components/reader/EpubReader';
import { PdfReader } from '../components/reader/PdfReader';
import { ReaderSettings } from '../components/reader/ReaderSettings';
import { api } from '../lib/api';
import type { BookDetail, ReadingProgress } from '@npc-shelf/shared';

/** How long the toolbar stays visible after mouse/touch activity (ms). */
const TOOLBAR_AUTO_HIDE_MS = 4_000;
/** Debounce delay for saving reading progress (ms). */
const PROGRESS_SAVE_DEBOUNCE_MS = 2_000;

export function ReadPage() {
  const { bookId } = useParams({ strict: false }) as { bookId: string };
  const [showSettings, setShowSettings] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showToolbar, setShowToolbar] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const toolbarTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: book } = useQuery({
    queryKey: ['book', bookId],
    queryFn: () => api.get<BookDetail>(`/books/${bookId}`),
    enabled: !!bookId,
  });

  const { data: progress } = useQuery({
    queryKey: ['reader-progress', bookId],
    queryFn: () => api.get<ReadingProgress | null>(`/reader/books/${bookId}/progress`),
    enabled: !!bookId,
  });

  const saveProgress = useMutation({
    mutationFn: (data: { format: string; cfi?: string; pageNumber?: number; totalPages?: number; progressPercent: number }) =>
      api.put(`/reader/books/${bookId}/progress`, data),
  });

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleEpubLocationChange = useCallback(
    (cfi: string, progressPercent: number) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        saveProgress.mutate({ format: 'epub', cfi, progressPercent });
      }, PROGRESS_SAVE_DEBOUNCE_MS);
    },
    [saveProgress],
  );

  const handlePdfPageChange = useCallback(
    (page: number, totalPages: number) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        saveProgress.mutate({
          format: 'pdf',
          pageNumber: page,
          totalPages,
          progressPercent: totalPages > 0 ? page / totalPages : 0,
        });
      }, PROGRESS_SAVE_DEBOUNCE_MS);
    },
    [saveProgress],
  );

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  }, []);

  // Auto-hide toolbar
  const resetToolbarTimer = useCallback(() => {
    setShowToolbar(true);
    if (toolbarTimer.current) clearTimeout(toolbarTimer.current);
    toolbarTimer.current = setTimeout(() => setShowToolbar(false), TOOLBAR_AUTO_HIDE_MS);
  }, []);

  // Determine which format to read
  const epubFile = book?.files?.find((f) => f.format === 'epub');
  const pdfFile = book?.files?.find((f) => f.format === 'pdf');
  const readerFormat = epubFile ? 'epub' : pdfFile ? 'pdf' : null;
  const contentUrl = readerFormat ? `/api/reader/books/${bookId}/content?format=${readerFormat}` : null;

  if (!contentUrl || !readerFormat) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">No readable file found for this book.</p>
      </div>
    );
  }

  const showSettingsButton = readerFormat === 'epub'; // Settings only apply to EPUB

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-50 flex flex-col bg-background"
      onMouseMove={resetToolbarTimer}
      onTouchStart={resetToolbarTimer}
    >
      {/* Toolbar */}
      <div
        className={`flex items-center justify-between border-b bg-background/95 px-4 py-2 backdrop-blur transition-opacity duration-300 ${showToolbar ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      >
        <div className="flex items-center gap-3">
          <Link to="/library/$bookId" params={{ bookId }}>
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <span className="truncate text-sm font-medium">
            {book?.title || 'Loading...'}
          </span>
        </div>

        <div className="flex items-center gap-1">
          {showSettingsButton && (
            <Button
              variant={showSettings ? 'secondary' : 'ghost'}
              size="icon"
              onClick={() => setShowSettings(!showSettings)}
            >
              <Settings className="h-4 w-4" />
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={toggleFullscreen}>
            {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* Reader area */}
      <div className="relative flex-1 overflow-hidden">
        {readerFormat === 'epub' ? (
          <EpubReader
            url={contentUrl}
            initialCfi={progress?.cfi}
            onLocationChange={handleEpubLocationChange}
          />
        ) : (
          <PdfReader
            url={contentUrl}
            initialPage={progress?.pageNumber}
            onPageChange={handlePdfPageChange}
          />
        )}

        {/* Settings popover (EPUB only) */}
        {showSettings && readerFormat === 'epub' && (
          <>
            <div
              className="absolute inset-0 z-10"
              onClick={() => setShowSettings(false)}
            />
            <div className="absolute right-4 top-2 z-20 rounded-lg border bg-card shadow-lg">
              <ReaderSettings />
            </div>
          </>
        )}
      </div>

      {/* Progress indicator */}
      {progress && (
        <div className="h-0.5 bg-muted">
          <div
            className="h-full bg-primary transition-all duration-500"
            style={{ width: `${(progress.progressPercent || 0) * 100}%` }}
          />
        </div>
      )}
    </div>
  );
}
