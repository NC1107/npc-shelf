import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, FolderSync, Loader2 } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Separator } from '../components/ui/separator';
import { api } from '../lib/api';
import type { Library as LibraryType } from '@npc-shelf/shared';

export function SettingsPage() {
  const queryClient = useQueryClient();
  const [newLibName, setNewLibName] = useState('');
  const [newLibPath, setNewLibPath] = useState('');
  const [newLibType, setNewLibType] = useState<'ebook' | 'audiobook' | 'mixed'>('mixed');

  const { data: libraries } = useQuery({
    queryKey: ['libraries'],
    queryFn: () => api.get<LibraryType[]>('/libraries'),
  });

  const addLibrary = useMutation({
    mutationFn: (lib: { name: string; path: string; type: string }) =>
      api.post('/libraries', lib),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['libraries'] });
      setNewLibName('');
      setNewLibPath('');
    },
  });

  const deleteLibrary = useMutation({
    mutationFn: (id: number) => api.delete(`/libraries/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['libraries'] }),
  });

  const scanLibrary = useMutation({
    mutationFn: (id: number) => api.post(`/libraries/${id}/scan`),
  });

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      {/* Libraries */}
      <Card>
        <CardHeader>
          <CardTitle>Libraries</CardTitle>
          <CardDescription>Manage your book and audiobook directories</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {libraries && libraries.length > 0 && (
            <div className="space-y-2">
              {libraries.map((lib) => (
                <div key={lib.id} className="flex items-center gap-3 rounded-lg border p-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{lib.name}</p>
                    <p className="truncate text-sm text-muted-foreground">{lib.path}</p>
                    <p className="text-xs text-muted-foreground">
                      Type: {lib.type} · Last scanned: {lib.lastScannedAt || 'Never'}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => scanLibrary.mutate(lib.id)}
                    disabled={scanLibrary.isPending}
                  >
                    <FolderSync className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => deleteLibrary.mutate(lib.id)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <Separator />

          <div className="space-y-3">
            <p className="text-sm font-medium">Add Library</p>
            <Input
              placeholder="Library name"
              value={newLibName}
              onChange={(e) => setNewLibName(e.target.value)}
            />
            <Input
              placeholder="Path (e.g. /libraries/ebooks)"
              value={newLibPath}
              onChange={(e) => setNewLibPath(e.target.value)}
            />
            <select
              value={newLibType}
              onChange={(e) => setNewLibType(e.target.value as 'ebook' | 'audiobook' | 'mixed')}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="mixed">Mixed</option>
              <option value="ebook">Ebook</option>
              <option value="audiobook">Audiobook</option>
            </select>
            <Button
              onClick={() => addLibrary.mutate({ name: newLibName, path: newLibPath, type: newLibType })}
              disabled={!newLibName || !newLibPath || addLibrary.isPending}
            >
              {addLibrary.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              <Plus className="h-4 w-4" />
              Add Library
            </Button>
            {addLibrary.isError && (
              <p className="text-sm text-destructive">{(addLibrary.error as Error).message}</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
