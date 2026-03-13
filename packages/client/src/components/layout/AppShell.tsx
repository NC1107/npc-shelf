import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { AudioMiniPlayer } from '../audio/AudioMiniPlayer';
import { useAudioStore } from '../../stores/audioStore';

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const bookId = useAudioStore((s) => s.bookId);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar />
        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          {children}
        </main>
        {bookId && <AudioMiniPlayer />}
      </div>
    </div>
  );
}
