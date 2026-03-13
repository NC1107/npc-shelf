import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { ReactReader, ReactReaderStyle } from 'react-reader';
import type { Rendition } from 'epubjs';
import { useReaderStore } from '../../stores/readerStore';

interface EpubReaderProps {
  url: string;
  initialCfi?: string | null;
  onLocationChange?: (cfi: string, progress: number) => void;
}

export function EpubReader({ url, initialCfi, onLocationChange }: EpubReaderProps) {
  const [location, setLocation] = useState<string | null>(initialCfi || null);
  const [epubData, setEpubData] = useState<ArrayBuffer | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const { fontSize, fontFamily, theme, lineHeight, margins } = useReaderStore();

  // Fetch EPUB as ArrayBuffer so epub.js unpacks it in memory
  // instead of making relative URL requests (which would hit auth)
  useEffect(() => {
    let cancelled = false;
    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to fetch EPUB: ${res.status}`);
        return res.arrayBuffer();
      })
      .then((data) => {
        if (!cancelled) setEpubData(data);
      })
      .catch((err) => console.error('[EpubReader] Load error:', err));
    return () => { cancelled = true; };
  }, [url]);

  const locationChanged = useCallback(
    (epubcfi: string) => {
      setLocation(epubcfi);
      if (renditionRef.current && onLocationChange) {
        const displayed = renditionRef.current.location;
        const progress = displayed?.start?.percentage ?? 0;
        onLocationChange(epubcfi, progress);
      }
    },
    [onLocationChange],
  );

  // Apply reader settings to rendition
  useEffect(() => {
    if (!renditionRef.current) return;

    const themeColors: Record<string, { color: string; bg: string }> = {
      light: { color: '#1a1a1a', bg: '#ffffff' },
      dark: { color: '#e0e0e0', bg: '#1a1a2e' },
      sepia: { color: '#5b4636', bg: '#f4ecd8' },
    };

    renditionRef.current.themes.override('font-size', `${fontSize}px`);
    renditionRef.current.themes.override('font-family', fontFamily);
    renditionRef.current.themes.override('line-height', `${lineHeight}`);
    renditionRef.current.themes.override('padding', `0 ${margins}px`);

    const colors = themeColors[theme];
    if (colors) {
      renditionRef.current.themes.override('color', colors.color);
      renditionRef.current.themes.override('background', colors.bg);
    }
  }, [fontSize, fontFamily, theme, lineHeight, margins]);

  const themeColors: Record<string, { color: string; bg: string }> = {
    light: { color: '#1a1a1a', bg: '#ffffff' },
    dark: { color: '#e0e0e0', bg: '#1a1a2e' },
    sepia: { color: '#5b4636', bg: '#f4ecd8' },
  };

  // Style ReactReader's wrapper UI (arrows, TOC, container) to match theme
  const readerStyles = useMemo(() => {
    const colors = themeColors[theme] || themeColors.dark!;
    return {
      ...ReactReaderStyle,
      container: { ...ReactReaderStyle.container, overflow: 'hidden', height: '100%' },
      readerArea: { ...ReactReaderStyle.readerArea, backgroundColor: colors.bg, transition: 'background-color 0.3s' },
      titleArea: { ...ReactReaderStyle.titleArea, color: colors.color, display: 'none' },
      tocArea: { ...ReactReaderStyle.tocArea, background: colors.bg, color: colors.color },
      tocButton: { ...ReactReaderStyle.tocButton, color: colors.color },
      tocButtonExpanded: { ...ReactReaderStyle.tocButtonExpanded, background: colors.bg },
      tocButtonBar: { ...ReactReaderStyle.tocButtonBar, background: colors.color },
      arrow: { ...ReactReaderStyle.arrow, color: colors.color },
    };
  }, [theme]);

  const getRendition = useCallback((rendition: Rendition) => {
    renditionRef.current = rendition;

    // Apply initial styles
    const colors = themeColors[theme] || themeColors.dark!;
    rendition.themes.override('font-size', `${fontSize}px`);
    rendition.themes.override('font-family', fontFamily);
    rendition.themes.override('line-height', `${lineHeight}`);
    rendition.themes.override('padding', `0 ${margins}px`);
    rendition.themes.override('color', colors.color);
    rendition.themes.override('background', colors.bg);
  }, [fontSize, fontFamily, lineHeight, margins, theme]);

  if (!epubData) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">Loading book...</p>
      </div>
    );
  }

  return (
    <div className="h-full w-full">
      <ReactReader
        url={epubData}
        location={location}
        locationChanged={locationChanged}
        getRendition={getRendition}
        readerStyles={readerStyles}
        epubOptions={{
          allowScriptedContent: false,
        }}
      />
    </div>
  );
}
