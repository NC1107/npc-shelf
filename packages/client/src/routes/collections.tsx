import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Plus, Trash2, FolderOpen, BookOpen, Loader2 } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { api } from '../lib/api';
import type { Collection } from '@npc-shelf/shared';

interface CollectionWithCount extends Collection {
  bookCount: number;
}

export function CollectionsPage() {
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');

  const { data: collections, isLoading } = useQuery({
    queryKey: ['collections'],
    queryFn: () => api.get<CollectionWithCount[]>('/collections'),
  });

  const createCollection = useMutation({
    mutationFn: (data: { name: string; description?: string }) =>
      api.post('/collections', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['collections'] });
      setNewName('');
      setNewDesc('');
    },
  });

  const deleteCollection = useMutation({
    mutationFn: (id: number) => api.delete(`/collections/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['collections'] }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Collections</h1>
      </div>

      {/* Create new collection */}
      <div className="flex gap-2">
        <Input
          placeholder="Collection name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          className="max-w-xs"
        />
        <Input
          placeholder="Description (optional)"
          value={newDesc}
          onChange={(e) => setNewDesc(e.target.value)}
          className="max-w-xs"
        />
        <Button
          onClick={() => createCollection.mutate({ name: newName, description: newDesc || undefined })}
          disabled={!newName || createCollection.isPending}
        >
          {createCollection.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Create
        </Button>
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-32 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : collections && collections.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {collections.map((col) => (
            <Link
              key={col.id}
              to="/collections/$collectionId"
              params={{ collectionId: String(col.id) }}
              className="group rounded-lg border bg-card p-4 transition-colors hover:bg-muted/50"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <FolderOpen className="h-8 w-8 text-primary/70" />
                  <div>
                    <h3 className="font-semibold group-hover:text-primary transition-colors">{col.name}</h3>
                    {col.description && (
                      <p className="mt-0.5 text-sm text-muted-foreground line-clamp-2">{col.description}</p>
                    )}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => {
                    e.preventDefault();
                    deleteCollection.mutate(col.id);
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </div>
              <div className="mt-3 flex items-center gap-1 text-sm text-muted-foreground">
                <BookOpen className="h-3.5 w-3.5" />
                {col.bookCount} {col.bookCount === 1 ? 'book' : 'books'}
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="py-12 text-center">
          <FolderOpen className="mx-auto h-12 w-12 text-muted-foreground" />
          <p className="mt-3 text-lg font-medium">No collections yet</p>
          <p className="text-sm text-muted-foreground">Create a collection to organize your books.</p>
        </div>
      )}
    </div>
  );
}
