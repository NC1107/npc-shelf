import { useState, useRef, useEffect } from 'react';
import { X, ChevronDown } from 'lucide-react';
import { cn } from './utils';

interface ComboboxOption {
  value: string;
  label: string;
}

export interface ComboboxProps {
  options: ComboboxOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  'aria-labelledby'?: string;
}

export function Combobox({ options, value, onChange, placeholder = 'Select...', className, 'aria-labelledby': ariaLabelledBy }: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedLabel = options.find(o => o.value === value)?.label || '';

  const filtered = search
    ? options.filter(o => o.label.toLowerCase().includes(search.toLowerCase()))
    : options;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function handleSelect(optionValue: string) {
    onChange(optionValue);
    setOpen(false);
    setSearch('');
  }

  function handleClear(e: React.MouseEvent) {
    e.stopPropagation();
    onChange('');
    setSearch('');
  }

  return (
    <div ref={containerRef} className={cn('relative', className)} aria-labelledby={ariaLabelledBy}>
      <div
        className="flex items-center rounded-md border border-input bg-background px-3 py-1.5 text-sm cursor-pointer min-w-[160px]"
        onClick={() => {
          setOpen(!open);
          if (!open) setTimeout(() => inputRef.current?.focus(), 0);
        }}
      >
        {open ? (
          <input
            ref={inputRef}
            className="flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={selectedLabel || placeholder}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className={cn('flex-1 truncate', !value && 'text-muted-foreground')}>
            {selectedLabel || placeholder}
          </span>
        )}
        {value ? (
          <X className="h-3.5 w-3.5 shrink-0 text-muted-foreground hover:text-foreground ml-1" onClick={handleClear} />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground ml-1" />
        )}
      </div>

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-lg max-h-60 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-sm text-muted-foreground">No results</div>
          ) : (
            <>
              <button
                className={cn(
                  'w-full px-3 py-1.5 text-left text-sm hover:bg-accent transition-colors',
                  !value && 'font-medium',
                )}
                onClick={() => handleSelect('')}
              >
                {placeholder}
              </button>
              {filtered.map((option) => (
                <button
                  key={option.value}
                  className={cn(
                    'w-full px-3 py-1.5 text-left text-sm hover:bg-accent transition-colors',
                    option.value === value && 'bg-accent font-medium',
                  )}
                  onClick={() => handleSelect(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
