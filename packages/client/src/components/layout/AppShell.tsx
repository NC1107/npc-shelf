import { Loader2 } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { AudioMiniPlayer } from '../audio/AudioMiniPlayer';
import { useAudioStore } from '../../stores/audioStore';
import { useScanStore } from '../../stores/scanStore';
import { useScanPolling } from '../../hooks/useScanPolling';

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const bookId = useAudioStore((s) => s.bookId);
  const scanStatus = useScanStore((s) => s.scanStatus);

  // Global scan polling
  useScanPolling();

  const showBanner = scanStatus && scanStatus.status !== 'idle';

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar />
        {showBanner && (
          <div className="flex items-center gap-2 border-b bg-primary/10 px-4 py-1.5 text-xs">
            <Loader2 className="h-3 w-3 animate-spin" />
            {scanStatus.status === 'pending'
              ? 'Scan queued...'
              : scanStatus.status === 'scanning'
                ? `Scanning: ${scanStatus.filesProcessed}/${scanStatus.filesFound} files`
                : scanStatus.status === 'complete'
                  ? `Scan complete: ${scanStatus.booksAdded} added, ${scanStatus.booksUpdated} updated`
                  : scanStatus.status === 'error'
                    ? 'Scan failed'
                    : null}
          </div>
        )}
        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          {children}
        </main>
        {bookId && <AudioMiniPlayer />}
      </div>
    </div>
  );
}
