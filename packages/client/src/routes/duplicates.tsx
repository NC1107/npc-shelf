import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Copy, Merge, Loader2, CheckCircle2 } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Card, CardContent } from '../components/ui/card';
import { api } from '../lib/api';

interface DuplicateGroup {
  books: { id: number; title: string; authors: string[] }[];
  method: 'hash' | 'title_author' | 'isbn';
  similarity: number;
}

type MethodFilter = 'all' | 'hash' | 'title_author' | 'isbn';

const METHOD_CONFIG: Record<
  DuplicateGroup['method'],
  { label: string; color: string }
> = {
  hash: { label: 'Hash Match', color: 'bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/25' },
  title_author: { label: 'Title/Author', color: 'bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/25' },
  isbn: { label: 'ISBN', color: 'bg-purple-500/15 text-purple-700 dark:text-purple-400 border-purple-500/25' },
};

const FILTER_OPTIONS: { value: MethodFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'hash', label: 'Hash Match' },
  { value: 'title_author', label: 'Title/Author' },
  { value: 'isbn', label: 'ISBN' },
];

export function DuplicatesPage() {
  const queryClient = useQueryClient();
  const [methodFilter, setMethodFilter] = useState<MethodFilter>('all');
  const [selectedTargets, setSelectedTargets] = useState<Map<number, number>>(new Map());

  const { data: groups, isLoading } = useQuery({
    queryKey: ['duplicates'],
    queryFn: () => api.get<DuplicateGroup[]>('/books/duplicates'),
  });

  const mergeMutation = useMutation({
    mutationFn: (data: { sourceBookId: number; targetBookId: number }) =>
      api.post('/books/merge', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['duplicates'] });
      queryClient.invalidateQueries({ queryKey: ['books'] });
    },
  });

  const filteredGroups = groups?.filter(
    (g) => methodFilter === 'all' || g.method === methodFilter,
  );

  const totalCount = groups?.length ?? 0;

  function handleSelect(groupIndex: number, bookId: number) {
    setSelectedTargets((prev) => {
      const next = new Map(prev);
      next.set(groupIndex, bookId);
      return next;
    });
  }

  function handleMerge(groupIndex: number, group: DuplicateGroup) {
    const targetId = selectedTargets.get(groupIndex);
    if (!targetId) return;

    const sourceBooks = group.books.filter((b) => b.id !== targetId);
    for (const source of sourceBooks) {
      mergeMutation.mutate({ sourceBookId: source.id, targetBookId: targetId });
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Duplicates</h1>
          {totalCount > 0 && (
            <Badge variant="secondary">{totalCount} group{totalCount !== 1 ? 's' : ''}</Badge>
          )}
        </div>
      </div>

      {/* Method filter badges */}
      <div className="flex flex-wrap gap-2">
        {FILTER_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setMethodFilter(opt.value)}
            aria-pressed={methodFilter === opt.value}
            className={`inline-flex items-center rounded-md border px-3 py-1 text-sm font-medium transition-colors ${
              methodFilter === opt.value
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-background text-foreground hover:bg-muted'
            }`}
          >
            {opt.label}
            {opt.value !== 'all' && groups && (
              <span className="ml-1.5 text-xs opacity-70">
                {groups.filter((g) => g.method === opt.value).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-36 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      ) : filteredGroups && filteredGroups.length > 0 ? (
        <div className="space-y-4">
          {filteredGroups.map((group, groupIndex) => {
            const config = METHOD_CONFIG[group.method];
            const selectedId = selectedTargets.get(groupIndex);

            return (
              <Card key={groupIndex}>
                <CardContent className="p-5">
                  <div className="mb-4 flex items-center gap-3">
                    <Badge className={config.color}>{config.label}</Badge>
                    <span className="text-sm text-muted-foreground">
                      {Math.round(group.similarity * 100)}% similar
                    </span>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    {group.books.map((book) => {
                      const isSelected = selectedId === book.id;

                      return (
                        <button
                          key={book.id}
                          type="button"
                          onClick={() => handleSelect(groupIndex, book.id)}
                          className={`relative flex flex-col gap-1 rounded-lg border p-4 text-left transition-colors ${
                            isSelected
                              ? 'border-primary bg-primary/5 ring-1 ring-primary'
                              : 'border-border hover:border-muted-foreground/30 hover:bg-muted/50'
                          }`}
                        >
                          {isSelected && (
                            <div className="absolute right-3 top-3">
                              <CheckCircle2 className="h-5 w-5 text-primary" />
                            </div>
                          )}
                          <Link
                            to="/library/$bookId"
                            params={{ bookId: String(book.id) }}
                            className="font-medium hover:text-primary hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {book.title}
                          </Link>
                          {book.authors.length > 0 && (
                            <span className="text-sm text-muted-foreground">
                              {book.authors.join(', ')}
                            </span>
                          )}
                          {isSelected && (
                            <span className="mt-1 text-xs font-medium text-primary">
                              Keep this book
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>

                  <div className="mt-4 flex justify-end">
                    <Button
                      size="sm"
                      disabled={!selectedId || mergeMutation.isPending}
                      onClick={() => handleMerge(groupIndex, group)}
                    >
                      {mergeMutation.isPending ? (
                        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                      ) : (
                        <Merge className="mr-1.5 h-4 w-4" />
                      )}
                      Merge
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <div className="py-12 text-center">
          <Copy className="mx-auto h-12 w-12 text-muted-foreground" />
          <p className="mt-3 text-lg font-medium">No duplicates detected</p>
          <p className="text-sm text-muted-foreground">
            {methodFilter !== 'all'
              ? 'No duplicates found for this detection method. Try a different filter.'
              : 'Your library looks clean. No duplicate books were found.'}
          </p>
        </div>
      )}
    </div>
  );
}
