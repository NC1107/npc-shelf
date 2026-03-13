import { useState, useRef, useCallback, useEffect } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '../ui/button';

// Set worker source
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

interface PdfReaderProps {
  url: string;
  initialPage?: number | null;
  onPageChange?: (page: number, totalPages: number) => void;
}

export function PdfReader({ url, initialPage, onPageChange }: PdfReaderProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pdfDocRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  const [currentPage, setCurrentPage] = useState(initialPage || 1);
  const [totalPages, setTotalPages] = useState(0);
  const [scale, setScale] = useState(1);
  const [loading, setLoading] = useState(true);
  const renderTaskRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load PDF document
  useEffect(() => {
    let cancelled = false;

    async function loadPdf() {
      setLoading(true);
      try {
        const doc = await pdfjsLib.getDocument(url).promise;
        if (cancelled) return;
        pdfDocRef.current = doc;
        setTotalPages(doc.numPages);
        setCurrentPage(initialPage && initialPage <= doc.numPages ? initialPage : 1);
        setLoading(false);
      } catch (err) {
        console.error('[PdfReader] Failed to load PDF:', err);
        setLoading(false);
      }
    }

    loadPdf();
    return () => {
      cancelled = true;
      pdfDocRef.current?.destroy();
      pdfDocRef.current = null;
    };
  }, [url, initialPage]);

  // Render current page
  const renderPage = useCallback(async (pageNum: number) => {
    const doc = pdfDocRef.current;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!doc || !canvas || !container) return;

    try {
      const page = await doc.getPage(pageNum);
      const containerWidth = container.clientWidth - 40; // padding
      const containerHeight = container.clientHeight - 40;

      const viewport = page.getViewport({ scale: 1 });
      const scaleW = containerWidth / viewport.width;
      const scaleH = containerHeight / viewport.height;
      const fitScale = Math.min(scaleW, scaleH, 2) * scale;

      const scaledViewport = page.getViewport({ scale: fitScale });
      canvas.width = scaledViewport.width;
      canvas.height = scaledViewport.height;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      await page.render({
        canvasContext: ctx,
        canvas,
        viewport: scaledViewport,
      }).promise;
    } catch (err) {
      console.error('[PdfReader] Render error:', err);
    }
  }, [scale]);

  // Re-render when page or scale changes
  useEffect(() => {
    if (!pdfDocRef.current || loading) return;

    // Debounce renders
    if (renderTaskRef.current) clearTimeout(renderTaskRef.current);
    renderTaskRef.current = setTimeout(() => {
      renderPage(currentPage);
    }, 50);
  }, [currentPage, scale, loading, renderPage]);

  // Re-render on window resize
  useEffect(() => {
    const handleResize = () => {
      if (renderTaskRef.current) clearTimeout(renderTaskRef.current);
      renderTaskRef.current = setTimeout(() => {
        renderPage(currentPage);
      }, 200);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [currentPage, renderPage]);

  const goToPage = useCallback(
    (page: number) => {
      if (page < 1 || page > totalPages) return;
      setCurrentPage(page);
      onPageChange?.(page, totalPages);
    },
    [totalPages, onPageChange],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ') {
        e.preventDefault();
        goToPage(currentPage + 1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goToPage(currentPage - 1);
      }
    },
    [currentPage, goToPage],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-muted-foreground">Loading PDF...</div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Canvas area */}
      <div
        ref={containerRef}
        className="flex flex-1 items-center justify-center overflow-auto bg-muted/30 p-5"
      >
        <canvas ref={canvasRef} className="shadow-lg" />
      </div>

      {/* Bottom controls */}
      <div className="flex items-center justify-center gap-3 border-t bg-background px-4 py-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => goToPage(currentPage - 1)}
          disabled={currentPage <= 1}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-2 text-sm">
          <input
            type="number"
            min={1}
            max={totalPages}
            value={currentPage}
            onChange={(e) => {
              const p = parseInt(e.target.value);
              if (p >= 1 && p <= totalPages) goToPage(p);
            }}
            className="w-14 rounded border bg-background px-2 py-1 text-center text-sm"
          />
          <span className="text-muted-foreground">/ {totalPages}</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => goToPage(currentPage + 1)}
          disabled={currentPage >= totalPages}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>

        <div className="ml-4 flex items-center gap-1 border-l pl-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setScale((s) => Math.max(0.5, s - 0.25))}
            disabled={scale <= 0.5}
          >
            -
          </Button>
          <span className="w-14 text-center text-xs text-muted-foreground">
            {Math.round(scale * 100)}%
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setScale((s) => Math.min(3, s + 0.25))}
            disabled={scale >= 3}
          >
            +
          </Button>
        </div>
      </div>
    </div>
  );
}
