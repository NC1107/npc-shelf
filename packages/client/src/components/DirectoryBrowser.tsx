import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Folder, ChevronRight, ArrowUp, Loader2, Music, BookOpen } from 'lucide-react';
import { Button } from './ui/button';
import { ScrollArea } from './ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from './ui/dialog';
import { api } from '../lib/api';

interface BrowseResponse {
  currentPath: string;
  parent: string | null;
  directories: { name: string; path: string }[];
  audioFiles: number;
  ebookFiles: number;
}

interface DirectoryBrowserProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (path: string) => void;
}

export function DirectoryBrowser({ open, onOpenChange, onSelect }: DirectoryBrowserProps) {
  const [currentPath, setCurrentPath] = useState<string | undefined>(undefined);

  const { data, isLoading } = useQuery({
    queryKey: ['directory-browse', currentPath],
    queryFn: () => api.get<BrowseResponse>(
      `/libraries/browse${currentPath ? `?path=${encodeURIComponent(currentPath)}` : ''}`,
    ),
    enabled: open,
  });

  const breadcrumbs = data?.currentPath
    ? data.currentPath.split(/[/\\]/).filter(Boolean)
    : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Browse Directories</DialogTitle>
          <DialogDescription>
            Navigate to select a library directory
          </DialogDescription>
        </DialogHeader>

        {/* Breadcrumb */}
        {data && (
          <div className="flex items-center gap-1 overflow-x-auto text-xs text-muted-foreground">
            <button
              className="shrink-0 hover:text-foreground"
              onClick={() => setCurrentPath(undefined)}
            >
              Root
            </button>
            {breadcrumbs.map((segment, i) => {
              const pathUpTo = breadcrumbs.slice(0, i + 1).join('/');
              const fullPath = data.currentPath.startsWith('/') ? '/' + pathUpTo : pathUpTo;
              return (
                <span key={i} className="flex items-center gap-1">
                  <ChevronRight className="h-3 w-3 shrink-0" />
                  <button
                    className="shrink-0 hover:text-foreground"
                    onClick={() => setCurrentPath(fullPath)}
                  >
                    {segment}
                  </button>
                </span>
              );
            })}
          </div>
        )}

        {/* File counts */}
        {data && (data.audioFiles > 0 || data.ebookFiles > 0) && (
          <div className="flex gap-3 text-xs text-muted-foreground">
            {data.ebookFiles > 0 && (
              <span className="flex items-center gap-1">
                <BookOpen className="h-3 w-3" /> {data.ebookFiles} ebooks
              </span>
            )}
            {data.audioFiles > 0 && (
              <span className="flex items-center gap-1">
                <Music className="h-3 w-3" /> {data.audioFiles} audio files
              </span>
            )}
          </div>
        )}

        {/* Directory list */}
        <ScrollArea className="h-64 rounded-md border">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="p-2">
              {/* Parent directory */}
              {data?.parent && (
                <button
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent"
                  onClick={() => setCurrentPath(data.parent!)}
                >
                  <ArrowUp className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">..</span>
                </button>
              )}

              {data?.directories.map((dir) => (
                <button
                  key={dir.path}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent"
                  onClick={() => setCurrentPath(dir.path)}
                >
                  <Folder className="h-4 w-4 text-muted-foreground" />
                  <span className="truncate">{dir.name}</span>
                </button>
              ))}

              {data?.directories.length === 0 && !data?.parent && (
                <p className="py-4 text-center text-sm text-muted-foreground">No subdirectories</p>
              )}
            </div>
          )}
        </ScrollArea>

        {/* Action buttons */}
        <div className="flex justify-between">
          <p className="truncate text-xs text-muted-foreground leading-8">
            {data?.currentPath || ''}
          </p>
          <Button
            onClick={() => {
              if (data?.currentPath) {
                onSelect(data.currentPath);
                onOpenChange(false);
              }
            }}
            disabled={!data?.currentPath}
          >
            Select This Directory
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
