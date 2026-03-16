import { useState, useMemo } from 'react';
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

interface DuplicateGroup {
  authors: Author[];
  similarity: number;
}

export function AuthorsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [roleTab, setRoleTab] = useState<'author' | 'narrator'>('author');
  const [showDedupConfirm, setShowDedupConfirm] = useState(false);
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editData, setEditData] = useState<{ name: string; sortName: string }>({ name: '', sortName: '' });
  const [mergeTargetId, setMergeTargetId] = useState<number | null>(null);
  const [confirmingMergeGroup, setConfirmingMergeGroup] = useState<number | null>(null);
  const [linkingAuthorId, setLinkingAuthorId] = useState<number | null>(null);
  const [linkSearch, setLinkSearch] = useState('');

  const { data: authors, isLoading } = useQuery({
    queryKey: ['authors', roleTab],
    queryFn: () => api.get<Author[]>(`/authors?role=${roleTab}`),
  });

  const { data: duplicates, isLoading: duplicatesLoading } = useQuery({
    queryKey: ['author-duplicates'],
    queryFn: () => api.get<DuplicateGroup[]>('/authors/duplicates'),
    enabled: showDuplicates,
  });

  const editAuthor = useMutation({
    mutationFn: ({ id, data }: { id: number; data: { name?: string; sortName?: string } }) =>
      api.put(`/authors/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['authors'] });
      queryClient.invalidateQueries({ queryKey: ['author-duplicates'] });
      setEditingId(null);
    },
    onError: (err) => console.error('Failed to edit author:', err),
  });

  const mergeAuthors = useMutation({
    mutationFn: (data: { sourceIds: number[]; targetId: number }) =>
      api.post('/authors/merge', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['authors'] });
      queryClient.invalidateQueries({ queryKey: ['author-duplicates'] });
      setConfirmingMergeGroup(null);
      setMergeTargetId(null);
    },
    onError: (err) => console.error('Failed to merge authors:', err),
  });

  const autoDedup = useMutation({
    mutationFn: () => api.post<{ merged: number; groups: number }>('/authors/auto-dedup'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['authors'] });
      queryClient.invalidateQueries({ queryKey: ['author-duplicates'] });
    },
    onError: (err) => console.error('Failed to auto-dedup:', err),
  });

  interface HardcoverAuthor {
    id: number;
    name: string;
    bio: string | null;
    imageUrl: string | null;
  }

  const { data: hardcoverResults, isLoading: hardcoverLoading } = useQuery({
    queryKey: ['hardcover-author-search', linkSearch],
    queryFn: () => api.get<HardcoverAuthor[]>(`/authors/search-hardcover?q=${encodeURIComponent(linkSearch)}`),
    enabled: !!linkSearch && linkSearch.length >= 2 && linkingAuthorId !== null,
  });

  const linkHardcover = useMutation({
    mutationFn: ({ authorId, hardcoverId }: { authorId: number; hardcoverId: number }) =>
      api.post(`/authors/${authorId}/link-hardcover`, { hardcoverId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['authors'] });
      setLinkingAuthorId(null);
      setLinkSearch('');
    },
    onError: (err) => console.error('Failed to link author:', err),
  });

  const filteredAuthors = useMemo(() => {
    if (!authors) return [];
    if (!search.trim()) return authors;
    const q = search.toLowerCase();
    return authors.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.sortName.toLowerCase().includes(q),
    );
  }, [authors, search]);

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
          {authors && (
            <Badge variant="secondary">{authors.length}</Badge>
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
          onClick={() => setRoleTab('author')}
        >
          Authors
        </button>
        <button
          className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${roleTab === 'narrator' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          onClick={() => setRoleTab('narrator')}
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
          onChange={(e) => setSearch(e.target.value)}
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
            {duplicatesLoading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : !duplicates || duplicates.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                No potential duplicates found.
              </p>
            ) : (
              duplicates.map((group, groupIndex) => (
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
                          {author !== group.authors[group.authors.length - 1] && (
                            <span className="text-muted-foreground ml-2">/</span>
                          )}
                        </span>
                      ))}
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      <Badge variant="outline">
                        {Math.round(group.similarity * 100)}% match
                      </Badge>
                      {confirmingMergeGroup !== groupIndex && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => startMerge(groupIndex, group)}
                        >
                          <Merge className="h-3 w-3" />
                          Merge
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Merge confirmation */}
                  {confirmingMergeGroup === groupIndex && (
                    <div className="rounded-md bg-muted p-3 space-y-2">
                      <p className="text-sm font-medium">Keep which author?</p>
                      <div className="flex flex-wrap gap-2">
                        {group.authors.map((author) => (
                          <Button
                            key={author.id}
                            variant={mergeTargetId === author.id ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => setMergeTargetId(author.id)}
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
                          onClick={() => confirmMerge(group)}
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
                          onClick={cancelMerge}
                          disabled={mergeAuthors.isPending}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </CardContent>
        )}
      </Card>

      <Separator />

      {/* Author List */}
      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : filteredAuthors.length === 0 ? (
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
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {filteredAuthors.map((author) => (
            <div
              key={author.id}
              className="rounded-lg border bg-card p-4 transition-colors hover:bg-muted/50"
            >
              {editingId === author.id ? (
                /* Editing state */
                <div className="space-y-2">
                  <Input
                    value={editData.name}
                    onChange={(e) => setEditData((d) => ({ ...d, name: e.target.value }))}
                    placeholder="Name"
                    className="h-8 text-sm"
                  />
                  <Input
                    value={editData.sortName}
                    onChange={(e) => setEditData((d) => ({ ...d, sortName: e.target.value }))}
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
                /* Display state */
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
                                setLinkingAuthorId(author.id);
                                setLinkSearch(author.name);
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
                        startEdit(author);
                      }}
                      aria-label="Edit author"
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
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
              {hardcoverResults && hardcoverResults.length === 0 && !hardcoverLoading && (
                <div className="py-4 text-center">
                  <p className="text-sm text-muted-foreground">No matching authors found on Hardcover</p>
                  <p className="mt-1 text-xs text-muted-foreground">Try adjusting the search term</p>
                </div>
              )}
              {hardcoverResults?.map((hc) => (
                <div
                  key={hc.id}
                  className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer hover:bg-muted/50 transition-colors"
                  role="button"
                  tabIndex={0}
                  onClick={() => linkHardcover.mutate({ authorId: linkingAuthorId!, hardcoverId: hc.id })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      linkHardcover.mutate({ authorId: linkingAuthorId!, hardcoverId: hc.id });
                    }
                  }}
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
                </div>
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
