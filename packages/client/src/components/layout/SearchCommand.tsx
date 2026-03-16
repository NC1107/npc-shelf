import { useState, useEffect, useCallback } from 'react';
import { Command } from 'cmdk';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, Headphones, Users, Layers, Search, Settings, LayoutDashboard, Bookmark, Copy } from 'lucide-react';
import { api } from '../../lib/api';
import type { Book, Author, Series } from '@npc-shelf/shared';

interface SearchBook extends Book {
  formats?: string[];
  authors?: { author: { name: string } }[];
}

interface SearchResults {
  books: SearchBook[];
  authors: Author[];
  series: Series[];
}

const AUDIO_FORMATS = new Set(['m4b', 'mp3']);

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/library', label: 'Library', icon: BookOpen },
  { to: '/series', label: 'Series', icon: Layers },
  { to: '/collections', label: 'Collections', icon: Bookmark },
  { to: '/authors', label: 'Authors', icon: Users },
  { to: '/duplicates', label: 'Duplicates', icon: Copy },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export function SearchCommand() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const { data } = useQuery({
    queryKey: ['command-search', query],
    queryFn: () => api.get<SearchResults>(`/search?q=${encodeURIComponent(query)}`),
    enabled: query.length >= 2,
    staleTime: 30_000,
  });

  const go = useCallback(
    (path: string) => {
      setOpen(false);
      setQuery('');
      navigate({ to: path });
    },
    [navigate],
  );

  const hasAudio = (book: SearchBook) => book.formats?.some((f) => AUDIO_FORMATS.has(f));

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex h-9 w-full items-center gap-2 rounded-md border bg-muted/40 px-3 text-sm text-muted-foreground transition-colors hover:bg-muted sm:w-64"
      >
        <Search className="h-3.5 w-3.5" />
        <span className="flex-1 text-left">Search...</span>
        <kbd className="hidden rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium sm:inline-block">
          Ctrl+K
        </kbd>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-50 bg-black/50" onClick={() => setOpen(false)} />
          <div className="fixed left-1/2 top-[20%] z-50 w-full max-w-lg -translate-x-1/2 rounded-xl border bg-popover shadow-2xl">
            <Command label="Search" onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}>
              <Command.Input
                value={query}
                onValueChange={setQuery}
                placeholder="Search books, authors, series..."
                className="w-full border-b bg-transparent px-4 py-3 text-sm outline-none placeholder:text-muted-foreground"
                autoFocus
              />
              <Command.List className="max-h-80 overflow-y-auto p-2">
                <Command.Empty className="px-4 py-6 text-center text-sm text-muted-foreground">
                  No results found.
                </Command.Empty>

                {/* Navigation shortcuts — show when no search query */}
                {query.length < 2 && (
                  <Command.Group heading="Navigate" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground">
                    {NAV_ITEMS.map((item) => (
                      <Command.Item
                        key={item.to}
                        value={item.label}
                        onSelect={() => go(item.to)}
                        className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm aria-selected:bg-accent"
                      >
                        <item.icon className="h-4 w-4 text-muted-foreground" />
                        {item.label}
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}

                {/* Books */}
                {data && data.books.length > 0 && (
                  <Command.Group heading="Books" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground">
                    {data.books.slice(0, 8).map((book) => (
                      <Command.Item
                        key={book.id}
                        value={`book-${book.id}-${book.title}`}
                        onSelect={() => go(`/library/${book.id}`)}
                        className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm aria-selected:bg-accent"
                      >
                        {hasAudio(book) ? (
                          <Headphones className="h-4 w-4 shrink-0 text-muted-foreground" />
                        ) : (
                          <BookOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{book.title}</p>
                          {book.authors && book.authors.length > 0 && (
                            <p className="truncate text-xs text-muted-foreground">
                              {book.authors.map((a) => a.author.name).join(', ')}
                            </p>
                          )}
                        </div>
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}

                {/* Authors */}
                {data && data.authors.length > 0 && (
                  <Command.Group heading="Authors" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground">
                    {data.authors.slice(0, 5).map((author) => (
                      <Command.Item
                        key={author.id}
                        value={`author-${author.id}-${author.name}`}
                        onSelect={() => go(`/authors/${author.id}`)}
                        className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm aria-selected:bg-accent"
                      >
                        <Users className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="truncate">{author.name}</span>
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}

                {/* Series */}
                {data && data.series.length > 0 && (
                  <Command.Group heading="Series" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground">
                    {data.series.slice(0, 5).map((s) => (
                      <Command.Item
                        key={s.id}
                        value={`series-${s.id}-${s.name}`}
                        onSelect={() => go(`/series/${s.id}`)}
                        className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm aria-selected:bg-accent"
                      >
                        <Layers className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="truncate">{s.name}</span>
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}
              </Command.List>
            </Command>
          </div>
        </>
      )}
    </>
  );
}
