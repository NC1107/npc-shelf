import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, CheckCircle2, BookOpen, ExternalLink } from 'lucide-react';
import { Button } from '../ui/button';
import { Separator } from '../ui/separator';
import { Badge } from '../ui/badge';
import { api } from '../../lib/api';

interface HardcoverBook {
  hardcoverId: number;
  title: string;
  slug: string | null;
  imageUrl: string | null;
  authorNames: string[];
  statusId: number;
  statusName: string;
}

interface MatchedBook {
  localBook: {
    id: number;
    title: string;
    readingStatus: string;
    coverPath: string | null;
    updatedAt: string;
  };
  hardcoverStatus: number;
  hardcoverStatusName: string;
  suggestedLocalStatus: string | null;
}

interface SyncResult {
  matched: MatchedBook[];
  missing: HardcoverBook[];
  stats: { total: number; matched: number; missing: number };
}

export function HardcoverSyncPanel() {
  const queryClient = useQueryClient();
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [selectedUpdates, setSelectedUpdates] = useState<Set<number>>(new Set());

  const syncNow = useMutation({
    mutationFn: () => api.get<SyncResult>('/metadata/hardcover-library'),
    onSuccess: (data) => {
      setSyncResult(data);
      // Auto-select all books whose status differs
      const toSelect = new Set<number>();
      for (const m of data.matched) {
        if (m.suggestedLocalStatus && m.suggestedLocalStatus !== m.localBook.readingStatus) {
          toSelect.add(m.localBook.id);
        }
      }
      setSelectedUpdates(toSelect);
    },
  });

  const applyStatus = useMutation({
    mutationFn: () => {
      if (!syncResult) return Promise.resolve();
      const updates = syncResult.matched
        .filter(m => selectedUpdates.has(m.localBook.id) && m.suggestedLocalStatus)
        .map(m => ({ bookId: m.localBook.id, readingStatus: m.suggestedLocalStatus! }));
      return api.post('/metadata/sync-hardcover-status', { updates });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['books'] });
      queryClient.invalidateQueries({ queryKey: ['book-stats'] });
    },
  });

  const createCollections = useMutation({
    mutationFn: () => {
      if (!syncResult) return Promise.resolve();
      const books = syncResult.matched.map(m => ({
        bookId: m.localBook.id,
        statusName: m.hardcoverStatusName,
      }));
      return api.post('/metadata/sync-hardcover-collections', { books });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['collections'] });
    },
  });

  const toggleUpdate = (bookId: number) => {
    setSelectedUpdates(prev => {
      const next = new Set(prev);
      if (next.has(bookId)) next.delete(bookId);
      else next.add(bookId);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <Separator />
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Hardcover Reading List Sync</p>
          <p className="text-xs text-muted-foreground">Import reading status and create collections from your Hardcover lists</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => syncNow.mutate()}
          disabled={syncNow.isPending}
        >
          {syncNow.isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
          Sync Now
        </Button>
      </div>

      {syncResult && (
        <div className="space-y-4">
          {/* Stats bar */}
          <div className="flex gap-3 text-sm">
            <Badge variant="secondary">{syncResult.stats.total} on Hardcover</Badge>
            <Badge variant="outline" className="border-green-300 text-green-700 dark:text-green-300">
              {syncResult.stats.matched} matched
            </Badge>
            {syncResult.stats.missing > 0 && (
              <Badge variant="outline" className="border-yellow-300 text-yellow-700 dark:text-yellow-300">
                {syncResult.stats.missing} not in library
              </Badge>
            )}
          </div>

          {/* Matched books with status diff */}
          {syncResult.matched.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Matched Books</p>
              <div className="max-h-60 overflow-y-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-background">
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th scope="col" className="p-2 w-8"></th>
                      <th scope="col" className="p-2">Title</th>
                      <th scope="col" className="p-2">Hardcover</th>
                      <th scope="col" className="p-2">Local</th>
                    </tr>
                  </thead>
                  <tbody>
                    {syncResult.matched.map((m) => {
                      const differs = m.suggestedLocalStatus && m.suggestedLocalStatus !== m.localBook.readingStatus;
                      return (
                        <tr key={m.localBook.id} className="border-b last:border-0">
                          <td className="p-2">
                            {differs && (
                              <input
                                type="checkbox"
                                checked={selectedUpdates.has(m.localBook.id)}
                                onChange={() => toggleUpdate(m.localBook.id)}
                                className="accent-primary"
                              />
                            )}
                          </td>
                          <td className="p-2 font-medium truncate max-w-[200px]">{m.localBook.title}</td>
                          <td className="p-2 text-xs">{m.hardcoverStatusName}</td>
                          <td className="p-2 text-xs">
                            {m.localBook.readingStatus}
                            {differs && (
                              <span className="ml-1 text-primary">→ {m.suggestedLocalStatus}</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => applyStatus.mutate()}
                  disabled={applyStatus.isPending || selectedUpdates.size === 0}
                >
                  {applyStatus.isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                  Apply Reading Status ({selectedUpdates.size})
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => createCollections.mutate()}
                  disabled={createCollections.isPending}
                >
                  {createCollections.isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                  Create Collections
                </Button>
              </div>

              {applyStatus.isSuccess && (
                <p className="text-sm text-green-600 flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" /> Reading statuses updated
                </p>
              )}
              {createCollections.isSuccess && (
                <p className="text-sm text-green-600 flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" /> Collections created
                </p>
              )}
            </div>
          )}

          {/* Missing books */}
          {syncResult.missing.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">
                On Hardcover but not in your library ({syncResult.missing.length})
              </p>
              <div className="max-h-40 overflow-y-auto space-y-1">
                {syncResult.missing.map((hb) => (
                  <div key={hb.hardcoverId} className="flex items-center gap-2 rounded p-1.5 text-sm text-muted-foreground">
                    <BookOpen className="h-3 w-3 shrink-0" />
                    <span className="truncate flex-1">{hb.title}</span>
                    <span className="text-xs shrink-0">{hb.statusName}</span>
                    {hb.slug && (
                      <a
                        href={`https://hardcover.app/books/${hb.slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0"
                      >
                        <ExternalLink className="h-3 w-3 text-primary" />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
