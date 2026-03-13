import { Minus, Plus, Sun, Moon, Coffee } from 'lucide-react';
import { Button } from '../ui/button';
import { useReaderStore } from '../../stores/readerStore';

const FONT_FAMILIES = [
  { label: 'Serif', value: 'serif' },
  { label: 'Sans', value: 'sans-serif' },
  { label: 'Mono', value: 'monospace' },
];

const THEMES = [
  { label: 'Light', value: 'light' as const, icon: Sun, bg: 'bg-white', text: 'text-gray-900', border: 'border-gray-300' },
  { label: 'Dark', value: 'dark' as const, icon: Moon, bg: 'bg-[#1a1a2e]', text: 'text-gray-200', border: 'border-gray-600' },
  { label: 'Sepia', value: 'sepia' as const, icon: Coffee, bg: 'bg-[#f4ecd8]', text: 'text-[#5b4636]', border: 'border-amber-400' },
];

export function ReaderSettings() {
  const {
    fontSize, fontFamily, theme, lineHeight, margins,
    setFontSize, setFontFamily, setTheme, setLineHeight, setMargins,
  } = useReaderStore();

  return (
    <div className="w-72 space-y-5 p-4">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Reader Settings
      </h3>

      {/* Font Size */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground">Font Size</label>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => setFontSize(Math.max(12, fontSize - 1))}
          >
            <Minus className="h-3 w-3" />
          </Button>
          <span className="w-10 text-center text-sm font-medium">{fontSize}</span>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => setFontSize(Math.min(32, fontSize + 1))}
          >
            <Plus className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Font Family */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground">Font</label>
        <div className="flex gap-1.5">
          {FONT_FAMILIES.map((ff) => (
            <Button
              key={ff.value}
              variant={fontFamily === ff.value ? 'default' : 'outline'}
              size="sm"
              className="flex-1 text-xs"
              style={{ fontFamily: ff.value }}
              onClick={() => setFontFamily(ff.value)}
            >
              {ff.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Theme */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground">Theme</label>
        <div className="flex gap-1.5">
          {THEMES.map((t) => (
            <button
              key={t.value}
              onClick={() => setTheme(t.value)}
              className={`flex flex-1 items-center justify-center gap-1 rounded-md border px-2 py-1.5 text-xs font-medium transition-all ${t.bg} ${t.text} ${theme === t.value ? `ring-2 ring-primary ${t.border}` : 'border-transparent opacity-70 hover:opacity-100'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Line Height */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground">Line Height</label>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => setLineHeight(Math.max(1.0, lineHeight - 0.1))}
          >
            <Minus className="h-3 w-3" />
          </Button>
          <span className="w-10 text-center text-sm font-medium">{lineHeight.toFixed(1)}</span>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => setLineHeight(Math.min(2.5, lineHeight + 0.1))}
          >
            <Plus className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Margins */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground">Margins</label>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => setMargins(Math.max(0, margins - 10))}
          >
            <Minus className="h-3 w-3" />
          </Button>
          <span className="w-10 text-center text-sm font-medium">{margins}px</span>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => setMargins(Math.min(100, margins + 10))}
          >
            <Plus className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}
