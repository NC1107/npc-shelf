import { Loader2 } from 'lucide-react';
import { useRouterState } from '@tanstack/react-router';
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
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const onListenPage = pathname.endsWith('/listen');

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
            {(() => {
              switch (scanStatus.status) {
                case 'pending': return 'Scan queued...';
                case 'scanning': return `Scanning: ${scanStatus.filesProcessed}/${scanStatus.filesFound} files`;
                case 'complete': return `Scan complete: ${scanStatus.booksAdded} added, ${scanStatus.booksUpdated} updated`;
                case 'error': return 'Scan failed';
                default: return null;
              }
            })()}
          </div>
        )}
        <main className={`flex-1 overflow-y-auto p-4 md:p-6 ${bookId && !onListenPage ? 'pb-20' : ''}`}>
          {children}
        </main>
        {bookId && !onListenPage && <AudioMiniPlayer />}
      </div>
    </div>
  );
}
