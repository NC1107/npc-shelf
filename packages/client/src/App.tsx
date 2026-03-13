import { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { routeTree } from './routes/__root';
import { useAuthStore } from './stores/authStore';
import { useUiStore } from './stores/uiStore';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      retry: 1,
    },
  },
});

const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: 'intent',
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

export default function App() {
  const { setSetupRequired, login, setupRequired } = useAuthStore();
  const { theme } = useUiStore();

  // Check setup status and try token refresh on mount
  useEffect(() => {
    // Apply theme
    const root = document.documentElement;
    if (theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }

    // Check if setup is required
    fetch('/api/setup/status')
      .then((res) => res.json())
      .then((data) => {
        setSetupRequired(data.setupRequired);
        if (!data.setupRequired) {
          // Try refreshing token
          return fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
        }
      })
      .then((res) => {
        if (res?.ok) return res.json();
      })
      .then((data) => {
        if (data?.accessToken) {
          login(data.accessToken, null);
        }
      })
      .catch(() => {
        // Ignore — user will see login
      });
  }, []);

  if (setupRequired === null) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
