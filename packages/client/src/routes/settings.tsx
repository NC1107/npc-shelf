import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, FolderSync, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Separator } from '../components/ui/separator';
import { api } from '../lib/api';
import type { Library as LibraryType, ScanStatus } from '@npc-shelf/shared';

function useScanProgress(libraryId: number | null) {
  const [status, setStatus] = useState<ScanStatus | null>(null);

  useEffect(() => {
    if (!libraryId) {
      setStatus(null);
      return;
    }

    // Poll scan status every second
    const interval = setInterval(async () => {
      try {
        const data = await api.get<ScanStatus>(`/libraries/${libraryId}/scan/status`);
        setStatus(data);
        if (data.status === 'complete' || data.status === 'error' || data.status === 'idle') {
          // Keep showing for a moment then clear
          if (data.status === 'idle') {
            setStatus(null);
            clearInterval(interval);
          }
        }
      } catch {
        clearInterval(interval);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [libraryId]);

  return status;
}

export function SettingsPage() {
  const queryClient = useQueryClient();
  const [newLibName, setNewLibName] = useState('');
  const [newLibPath, setNewLibPath] = useState('');
  const [newLibType, setNewLibType] = useState<'ebook' | 'audiobook' | 'mixed'>('mixed');
  const [scanningLibId, setScanningLibId] = useState<number | null>(null);

  const scanStatus = useScanProgress(scanningLibId);

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
    onSuccess: (_data, id) => {
      setScanningLibId(id);
    },
  });

  // Clear scan state when complete and refresh libraries
  useEffect(() => {
    if (scanStatus?.status === 'complete') {
      queryClient.invalidateQueries({ queryKey: ['libraries'] });
      queryClient.invalidateQueries({ queryKey: ['books'] });
      const timer = setTimeout(() => setScanningLibId(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [scanStatus?.status, queryClient]);

  const isScanning = scanStatus?.status === 'scanning';

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
                <div key={lib.id} className="rounded-lg border p-3">
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{lib.name}</p>
                      <p className="truncate text-sm text-muted-foreground">{lib.path}</p>
                      <p className="text-xs text-muted-foreground">
                        Type: {lib.type} · Last scanned: {lib.lastScannedAt ? new Date(lib.lastScannedAt).toLocaleString() : 'Never'}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => scanLibrary.mutate(lib.id)}
                      disabled={isScanning && scanningLibId === lib.id}
                    >
                      {isScanning && scanningLibId === lib.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <FolderSync className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => deleteLibrary.mutate(lib.id)}
                      disabled={isScanning && scanningLibId === lib.id}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>

                  {/* Scan progress */}
                  {scanningLibId === lib.id && scanStatus && scanStatus.status !== 'idle' && (
                    <div className="mt-3 space-y-2">
                      {/* Progress bar */}
                      {scanStatus.filesFound > 0 && (
                        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full bg-primary transition-all"
                            style={{
                              width: `${Math.round((scanStatus.filesProcessed / scanStatus.filesFound) * 100)}%`,
                            }}
                          />
                        </div>
                      )}

                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {scanStatus.status === 'scanning' && (
                          <>
                            <Loader2 className="h-3 w-3 animate-spin" />
                            Scanning... {scanStatus.filesProcessed}/{scanStatus.filesFound} files
                            {scanStatus.booksAdded > 0 && ` · ${scanStatus.booksAdded} books added`}
                          </>
                        )}
                        {scanStatus.status === 'complete' && (
                          <>
                            <CheckCircle2 className="h-3 w-3 text-green-500" />
                            Scan complete: {scanStatus.booksAdded} added, {scanStatus.booksUpdated} updated
                          </>
                        )}
                        {scanStatus.status === 'error' && (
                          <>
                            <AlertCircle className="h-3 w-3 text-destructive" />
                            Scan failed
                          </>
                        )}
                      </div>

                      {scanStatus.errors.length > 0 && (
                        <div className="max-h-24 overflow-y-auto rounded bg-muted p-2 text-xs text-muted-foreground">
                          {scanStatus.errors.slice(0, 10).map((err, i) => (
                            <p key={i}>{err}</p>
                          ))}
                          {scanStatus.errors.length > 10 && (
                            <p>...and {scanStatus.errors.length - 10} more errors</p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
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
