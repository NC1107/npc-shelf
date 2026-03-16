import { useState, useDeferredValue } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  Users,
  Search,
  Pencil,
  Check,
  X,
  ChevronDown,
  ChevronUp,
  Loader2,
  BookOpen,
  AlertTriangle,
  Merge,
  User,
  Wand2,
  Link2,
  ExternalLink,
} from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Separator } from '../components/ui/separator';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '../components/ui/tooltip';
import { api } from '../lib/api';
import { ConfirmDialog } from '../components/ui/confirm-dialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';

interface Author {
  id: number;
  name: string;
  sortName: string;
  bio: string | null;
  photoUrl: string | null;
  hardcoverId: string | null;
  bookCount: number;
}

interface PaginatedAuthors {
  data: Author[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface DuplicateGroup {
  authors: Author[];
  similarity: number;
}

interface HardcoverAuthor {
  id: number;
  name: string;
  bio: string | null;
  imageUrl: string | null;
}

function DuplicateGroupRow({
  group,
  groupIndex,
  confirmingMergeGroup,
  mergeTargetId,
  mergeAuthors,
  onStartMerge,
  onConfirmMerge,
  onCancelMerge,
  onSetMergeTarget,
}: Readonly<{
  group: DuplicateGroup;
  groupIndex: number;
  confirmingMergeGroup: number | null;
  mergeTargetId: number | null;
  mergeAuthors: { isPending: boolean };
  onStartMerge: (groupIndex: number, group: DuplicateGroup) => void;
  onConfirmMerge: (group: DuplicateGroup) => void;
  onCancelMerge: () => void;
  onSetMergeTarget: (id: number) => void;
}>) {
  const isConfirming = confirmingMergeGroup === groupIndex;
  return (
    <div
      key={group.authors.map((a) => a.id).join('-')}
      className="rounded-lg border p-3 space-y-2"
    >
      <div className="flex items-center justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {group.authors.map((author) => (
            <span key={author.id} className="text-sm">
              <span className="font-medium">{author.name}</span>
              <span className="text-muted-foreground ml-1">
                ({author.bookCount} {author.bookCount === 1 ? 'book' : 'books'})
              </span>
              {author !== group.authors.at(-1) && (
                <span className="text-muted-foreground ml-2">/</span>
              )}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-2">
          <Badge variant="outline">
            {Math.round(group.similarity * 100)}% match
          </Badge>
          {!isConfirming && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onStartMerge(groupIndex, group)}
            >
              <Merge className="h-3 w-3" />
              Merge
            </Button>
          )}
        </div>
      </div>

      {isConfirming && (
        <div className="rounded-md bg-muted p-3 space-y-2">
          <p className="text-sm font-medium">Keep which author?</p>
          <div className="flex flex-wrap gap-2">
            {group.authors.map((author) => (
              <Button
                key={author.id}
                variant={mergeTargetId === author.id ? 'default' : 'outline'}
                size="sm"
                onClick={() => onSetMergeTarget(author.id)}
              >
                {author.name}
                <span className="ml-1 text-xs opacity-70">
                  ({author.bookCount})
                </span>
              </Button>
            ))}
          </div>
          <div className="flex gap-2 pt-1">
            <Button
              size="sm"
              onClick={() => onConfirmMerge(group)}
              disabled={mergeAuthors.isPending}
            >
              {mergeAuthors.isPending && (
                <Loader2 className="h-3 w-3 animate-spin" />
              )}
              Confirm Merge
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onCancelMerge}
              disabled={mergeAuthors.isPending}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function AuthorCardDisplay({
  author,
  onStartEdit,
  onStartLink,
}: Readonly<{
  author: Author;
  onStartEdit: (author: Author) => void;
  onStartLink: (author: Author) => void;
}>) {
  return (
    <div className="flex items-start gap-3">
      <Link to="/authors/$authorId" params={{ authorId: String(author.id) }} className="flex items-start gap-3 min-w-0 flex-1">
        {author.photoUrl ? (
          <img
            src={author.photoUrl}
            alt={author.name}
            className="h-10 w-10 shrink-0 rounded-full object-cover"
          />
        ) : (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted">
            <User className="h-5 w-5 text-muted-foreground" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="font-medium truncate">{author.name}</p>
          {author.sortName !== author.name && (
            <p className="text-xs text-muted-foreground truncate">
              {author.sortName}
            </p>
          )}
          <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            <BookOpen className="h-3 w-3" />
            {author.bookCount} {author.bookCount === 1 ? 'book' : 'books'}
          </div>
        </div>
      </Link>
      <div className="flex gap-0.5 shrink-0">
        {!author.hardcoverId && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  onClick={(e) => {
                    e.preventDefault();
                    onStartLink(author);
                  }}
                  aria-label="Link to Hardcover"
                >
                  <Link2 className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Link to Hardcover</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        {author.hardcoverId && (
          <a
            href={`https://hardcover.app/authors/${author.hardcoverId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
            aria-label="View on Hardcover"
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={(e) => {
            e.preventDefault();
            onStartEdit(author);
          }}
          aria-label="Edit author"
        >
          <Pencil className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

// -- Custom hook to reduce cognitive complexity of AuthorsPage --

function useAuthorMutations(callbacks: {
  setEditingId: (id: number | null) => void;
  setConfirmingMergeGroup: (id: number | null) => void;
  setMergeTargetId: (id: number | null) => void;
  setLinkingAuthorId: (id: number | null) => void;
  setLinkSearch: (s: string) => void;
}) {
  const queryClient = useQueryClient();
  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['authors'] });
    queryClient.invalidateQueries({ queryKey: ['author-duplicates'] });
  };

  const editAuthor = useMutation({
    mutationFn: ({ id, data }: { id: number; data: { name?: string; sortName?: string } }) =>
      api.put(`/authors/${id}`, data),
    onSuccess: () => { invalidateAll(); callbacks.setEditingId(null); },
    onError: (err) => console.error('Failed to edit author:', err),
  });

  const mergeAuthors = useMutation({
    mutationFn: (data: { sourceIds: number[]; targetId: number }) =>
      api.post('/authors/merge', data),
    onSuccess: () => { invalidateAll(); callbacks.setConfirmingMergeGroup(null); callbacks.setMergeTargetId(null); },
    onError: (err) => console.error('Failed to merge authors:', err),
  });

  const autoDedup = useMutation({
    mutationFn: () => api.post<{ merged: number; groups: number }>('/authors/auto-dedup'),
    onSuccess: invalidateAll,
    onError: (err) => console.error('Failed to auto-dedup:', err),
  });

  const linkHardcover = useMutation({
    mutationFn: ({ authorId, hardcoverId }: { authorId: number; hardcoverId: number }) =>
      api.post(`/authors/${authorId}/link-hardcover`, { hardcoverId }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['authors'] }); callbacks.setLinkingAuthorId(null); callbacks.setLinkSearch(''); },
    onError: (err) => console.error('Failed to link author:', err),
  });

  return { editAuthor, mergeAuthors, autoDedup, linkHardcover };
}

function AuthorListContent({
  isLoading,
  filteredAuthors,
  search,
  editingId,
  editData,
  setEditData,
  editAuthor,
  saveEdit,
  cancelEdit,
  startEdit,
  setLinkingAuthorId,
  setLinkSearch,
}: any) {
  if (isLoading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="h-20 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
    );
  }

  if (filteredAuthors.length === 0) {
    return (
      <div className="py-12 text-center">
        <Users className="mx-auto h-12 w-12 text-muted-foreground" />
        <p className="mt-3 text-lg font-medium">
          {search ? 'No authors match your search' : 'No authors found'}
        </p>
        <p className="text-sm text-muted-foreground">
          {search
            ? 'Try a different search term.'
            : 'Authors are added automatically when books are scanned.'}
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {filteredAuthors.map((author: Author) => (
        <div
          key={author.id}
          className="rounded-lg border bg-card p-4 transition-colors hover:bg-muted/50"
        >
          {editingId === author.id ? (
            <div className="space-y-2">
              <Input
                value={editData.name}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditData((d: { name: string; sortName: string }) => ({ ...d, name: e.target.value }))}
                placeholder="Name"
                className="h-8 text-sm"
              />
              <Input
                value={editData.sortName}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditData((d: { name: string; sortName: string }) => ({ ...d, sortName: e.target.value }))}
                placeholder="Sort name"
                className="h-8 text-sm"
              />
              <div className="flex gap-1">
                <Button
                  size="sm"
                  onClick={saveEdit}
                  disabled={editAuthor.isPending || !editData.name.trim()}
                >
                  {editAuthor.isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Check className="h-3 w-3" />
                  )}
                  Save
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={cancelEdit}
                  disabled={editAuthor.isPending}
                >
                  <X className="h-3 w-3" />
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <AuthorCardDisplay
              author={author}
              onStartEdit={startEdit}
              onStartLink={(a: Author) => {
                setLinkingAuthorId(a.id);
                setLinkSearch(a.name);
              }}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function generatePageNumbers(current: number, total: number): (number | '...')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | '...')[] = [1];
  if (current > 3) pages.push('...');
  for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) {
    pages.push(i);
  }
  if (current < total - 2) pages.push('...');
  pages.push(total);
  return pages;
}

function AuthorPagination({
  page,
  totalPages,
  onPageChange,
}: Readonly<{
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}>) {
  const pageNumbers = generatePageNumbers(page, totalPages);

  return (
    <nav aria-label="Authors pagination" className="flex items-center justify-center gap-2 pt-4">
      <Button
        variant="outline"
        size="sm"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        Previous
      </Button>
      <div className="flex items-center gap-1">
        {pageNumbers.map((p, idx) => {
          if (p === '...') {
            return <span key={`ellipsis-${idx}`} className="px-2 text-muted-foreground">...</span>;
          }
          return (
            <Button
              key={`page-${p}`}
              variant={p === page ? 'default' : 'outline'}
              size="sm"
              className="w-9"
              onClick={() => onPageChange(p)}
              {...(p === page ? { 'aria-current': 'page' as const } : {})}
            >
              {p}
            </Button>
          );
        })}
      </div>
      <Button
        variant="outline"
        size="sm"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
      >
        Next
      </Button>
    </nav>
  );
}

export function AuthorsPage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [roleTab, setRoleTab] = useState<'author' | 'narrator'>('author');
  const [showDedupConfirm, setShowDedupConfirm] = useState(false);
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editData, setEditData] = useState<{ name: string; sortName: string }>({ name: '', sortName: '' });
  const [mergeTargetId, setMergeTargetId] = useState<number | null>(null);
  const [confirmingMergeGroup, setConfirmingMergeGroup] = useState<number | null>(null);
  const [linkingAuthorId, setLinkingAuthorId] = useState<number | null>(null);
  const [linkSearch, setLinkSearch] = useState('');

  const deferredSearch = useDeferredValue(search);

  const { editAuthor, mergeAuthors, autoDedup, linkHardcover } = useAuthorMutations({
    setEditingId, setConfirmingMergeGroup, setMergeTargetId, setLinkingAuthorId, setLinkSearch,
  });

  const { data: authorsData, isLoading } = useQuery({
    queryKey: ['authors', roleTab, page, deferredSearch],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set('role', roleTab);
      params.set('page', String(page));
      params.set('limit', '50');
      if (deferredSearch) params.set('q', deferredSearch);
      return api.get<PaginatedAuthors>(`/authors?${params.toString()}`);
    },
  });

  const authors = authorsData?.data ?? [];
  const totalPages = authorsData?.totalPages ?? 1;
  const totalCount = authorsData?.total ?? 0;

  const { data: duplicates, isLoading: duplicatesLoading } = useQuery({
    queryKey: ['author-duplicates'],
    queryFn: () => api.get<DuplicateGroup[]>('/authors/duplicates'),
    enabled: showDuplicates,
  });

  const { data: hardcoverResults, isLoading: hardcoverLoading } = useQuery({
    queryKey: ['hardcover-author-search', linkSearch],
    queryFn: () => api.get<HardcoverAuthor[]>(`/authors/search-hardcover?q=${encodeURIComponent(linkSearch)}`),
    enabled: !!linkSearch && linkSearch.length >= 2 && linkingAuthorId !== null,
  });

  const startEdit = (author: Author) => {
    setEditingId(author.id);
    setEditData({ name: author.name, sortName: author.sortName });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditData({ name: '', sortName: '' });
  };

  const saveEdit = () => {
    if (editingId === null) return;
    editAuthor.mutate({ id: editingId, data: editData });
  };

  const startMerge = (groupIndex: number, group: DuplicateGroup) => {
    setConfirmingMergeGroup(groupIndex);
    // Default target is the author with the most books
    const sorted = [...group.authors].sort((a, b) => b.bookCount - a.bookCount);
    const topAuthor = sorted[0];
    if (topAuthor) {
      setMergeTargetId(topAuthor.id);
    }
  };

  const confirmMerge = (group: DuplicateGroup) => {
    if (mergeTargetId === null) return;
    const sourceIds = group.authors
      .filter((a) => a.id !== mergeTargetId)
      .map((a) => a.id);
    mergeAuthors.mutate({ sourceIds, targetId: mergeTargetId });
  };

  const cancelMerge = () => {
    setConfirmingMergeGroup(null);
    setMergeTargetId(null);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Authors</h1>
          {authorsData && (
            <Badge variant="secondary">{totalCount}</Badge>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowDedupConfirm(true)}
          disabled={autoDedup.isPending}
        >
          {autoDedup.isPending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Wand2 className="h-3 w-3" />
          )}
          {autoDedup.isSuccess
            ? `Merged ${(autoDedup.data as any)?.merged || 0} duplicates`
            : 'Auto-merge Duplicates'}
        </Button>
        <ConfirmDialog
          open={showDedupConfirm}
          onOpenChange={setShowDedupConfirm}
          title="Auto-merge duplicates"
          description="Merge duplicate authors based on normalized names? This cannot be undone."
          confirmLabel="Merge"
          onConfirm={() => autoDedup.mutate()}
        />
      </div>

      {/* Role tabs */}
      <div className="flex gap-1 rounded-lg bg-muted p-1">
        <button
          className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${roleTab === 'author' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          onClick={() => { setRoleTab('author'); setPage(1); }}
        >
          Authors
        </button>
        <button
          className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${roleTab === 'narrator' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          onClick={() => { setRoleTab('narrator'); setPage(1); }}
        >
          Narrators
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search authors..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="pl-9"
        />
      </div>

      {/* Duplicates Section */}
      <Card>
        <CardHeader
          className="cursor-pointer"
          role="button"
          tabIndex={0}
          aria-expanded={showDuplicates}
          onClick={() => setShowDuplicates(!showDuplicates)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setShowDuplicates(!showDuplicates);
            }
          }}
        >
          <CardTitle className="flex items-center justify-between text-base">
            <span className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Potential Duplicates
            </span>
            {showDuplicates ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </CardTitle>
        </CardHeader>
        {showDuplicates && (
          <CardContent className="space-y-3">
            {duplicatesLoading && (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}
            {!duplicatesLoading && (!duplicates || duplicates.length === 0) && (
              <p className="py-4 text-center text-sm text-muted-foreground">
                No potential duplicates found.
              </p>
            )}
            {!duplicatesLoading && duplicates && duplicates.length > 0 &&
              duplicates.map((group, groupIndex) => (
                <DuplicateGroupRow
                  key={group.authors.map((a) => a.id).join('-')}
                  group={group}
                  groupIndex={groupIndex}
                  confirmingMergeGroup={confirmingMergeGroup}
                  mergeTargetId={mergeTargetId}
                  mergeAuthors={mergeAuthors}
                  onStartMerge={startMerge}
                  onConfirmMerge={confirmMerge}
                  onCancelMerge={cancelMerge}
                  onSetMergeTarget={setMergeTargetId}
                />
              ))
            }
          </CardContent>
        )}
      </Card>

      <Separator />

      {/* Author List */}
      <AuthorListContent
        isLoading={isLoading}
        filteredAuthors={authors}
        search={search}
        editingId={editingId}
        editData={editData}
        setEditData={setEditData}
        editAuthor={editAuthor}
        saveEdit={saveEdit}
        cancelEdit={cancelEdit}
        startEdit={startEdit}
        setLinkingAuthorId={setLinkingAuthorId}
        setLinkSearch={setLinkSearch}
      />

      {/* Pagination */}
      {totalPages > 1 && (
        <AuthorPagination page={page} totalPages={totalPages} onPageChange={setPage} />
      )}

      {/* Hardcover link dialog */}
      <Dialog open={linkingAuthorId !== null} onOpenChange={(open) => { if (!open) { setLinkingAuthorId(null); setLinkSearch(''); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Link to Hardcover</DialogTitle>
          </DialogHeader>
            <Input
              value={linkSearch}
              onChange={(e) => setLinkSearch(e.target.value)}
              placeholder="Search Hardcover..."
              className="h-9"
            />
            <div className="max-h-64 space-y-2 overflow-y-auto">
              {hardcoverLoading && (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              )}
              {hardcoverResults?.length === 0 && !hardcoverLoading && (
                <div className="py-4 text-center">
                  <p className="text-sm text-muted-foreground">No matching authors found on Hardcover</p>
                  <p className="mt-1 text-xs text-muted-foreground">Try adjusting the search term</p>
                </div>
              )}
              {hardcoverResults?.map((hc) => (
                <button
                  type="button"
                  key={hc.id}
                  className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer hover:bg-muted/50 transition-colors bg-transparent text-left w-full"
                  onClick={() => linkHardcover.mutate({ authorId: linkingAuthorId!, hardcoverId: hc.id })}
                >
                  {hc.imageUrl ? (
                    <img src={hc.imageUrl} alt={hc.name} className="h-10 w-10 rounded-full object-cover shrink-0" />
                  ) : (
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted">
                      <User className="h-5 w-5 text-muted-foreground" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="font-medium text-sm">{hc.name}</p>
                    {hc.bio && (
                      <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{hc.bio}</p>
                    )}
                  </div>
                </button>
              ))}
            </div>
          {linkHardcover.isPending && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Linking...
            </div>
          )}
          {linkHardcover.isError && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertTriangle className="h-3 w-3" /> Failed to link author. Try again.
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
