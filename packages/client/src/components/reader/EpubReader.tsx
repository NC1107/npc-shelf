import { useState, useRef, useCallback, useEffect } from 'react';
import { ReactReader } from 'react-reader';
import type { Rendition } from 'epubjs';
import { useReaderStore } from '../../stores/readerStore';

interface EpubReaderProps {
  url: string;
  initialCfi?: string | null;
  onLocationChange?: (cfi: string, progress: number) => void;
}

export function EpubReader({ url, initialCfi, onLocationChange }: EpubReaderProps) {
  const [location, setLocation] = useState<string>(initialCfi || '');
  const renditionRef = useRef<Rendition | null>(null);
  const { fontSize, fontFamily, theme, lineHeight, margins } = useReaderStore();

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

  const getRendition = useCallback((rendition: Rendition) => {
    renditionRef.current = rendition;

    // Apply initial styles
    rendition.themes.override('font-size', `${fontSize}px`);
    rendition.themes.override('font-family', fontFamily);
    rendition.themes.override('line-height', `${lineHeight}`);
    rendition.themes.override('padding', `0 ${margins}px`);
  }, [fontSize, fontFamily, lineHeight, margins]);

  return (
    <div className="h-full w-full">
      <ReactReader
        url={url}
        location={location}
        locationChanged={locationChanged}
        getRendition={getRendition}
        epubOptions={{
          allowScriptedContent: false,
        }}
      />
    </div>
  );
}
