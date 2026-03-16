import { useEffect } from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import {
  BookOpen,
  Library,
  LayoutDashboard,
  Bookmark,
  Settings,
  Layers,
  X,
  Users,
  Copy,
} from 'lucide-react';
import { Button } from '../ui/button';
import { ScrollArea } from '../ui/scroll-area';
import { cn } from '../ui/utils';
import { useUiStore } from '../../stores/uiStore';

const navItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/library', label: 'Library', icon: Library },
  { to: '/series', label: 'Series', icon: Layers },
  { to: '/collections', label: 'Collections', icon: Bookmark },
  { to: '/authors', label: 'Authors', icon: Users },
  { to: '/duplicates', label: 'Duplicates', icon: Copy },
] as const;

const bottomItems = [
  { to: '/settings', label: 'Settings', icon: Settings },
] as const;

export function Sidebar() {
  const { sidebarOpen, setSidebarOpen } = useUiStore();
  const routerState = useRouterState();
  const currentPath = routerState.location.pathname;

  useEffect(() => {
    if (!sidebarOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSidebarOpen(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [sidebarOpen, setSidebarOpen]);

  return (
    <>
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          role="button"
          tabIndex={0}
          aria-label="Close sidebar"
          onClick={() => setSidebarOpen(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setSidebarOpen(false);
            }
          }}
        />
      )}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r bg-sidebar text-sidebar-foreground transition-transform lg:static lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        {/* Header */}
        <div className="flex h-14 items-center justify-between border-b px-4">
          <Link to="/" className="flex items-center gap-2 font-bold text-lg">
            <BookOpen className="h-5 w-5" />
            NPC-Shelf
          </Link>
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setSidebarOpen(false)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Navigation */}
        <ScrollArea className="flex-1 px-3 py-4">
          <nav className="flex flex-col gap-1">
            {navItems.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  currentPath === item.to
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                    : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                )}
                onClick={() => {
                  if (window.innerWidth < 1024) setSidebarOpen(false);
                }}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            ))}
          </nav>
        </ScrollArea>

        {/* Bottom */}
        <div className="border-t px-3 py-3">
          {bottomItems.map((item) => (
            <div key={item.to} className="flex items-center justify-between">
              <Link
                to={item.to}
                className={cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  currentPath === item.to
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                    : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
              <span className="pr-3 text-[10px] text-sidebar-foreground/30">v{__APP_VERSION__}</span>
            </div>
          ))}
        </div>
      </aside>
    </>
  );
}
