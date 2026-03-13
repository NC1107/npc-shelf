import { createRootRouteWithContext, createRoute, Outlet } from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';
import { AppShell } from '../components/layout/AppShell';
import { useAuthStore } from '../stores/authStore';
import { LoginPage } from './login';
import { DashboardPage } from './dashboard';
import { LibraryPage } from './library';
import { BookDetailPage } from './library.$bookId';
import { SearchPage } from './search';
import { SettingsPage } from './settings';
import { SetupPage } from './setup';

interface RouterContext {
  queryClient: QueryClient;
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: RootComponent,
});

function RootComponent() {
  const { isAuthenticated, setupRequired } = useAuthStore();

  if (setupRequired === true) {
    return <SetupPage />;
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: DashboardPage,
});

const libraryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/library',
  component: LibraryPage,
});

const bookDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/library/$bookId',
  component: BookDetailPage,
});

const searchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/search',
  component: SearchPage,
});

const collectionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/collections',
  component: () => <div className="text-foreground"><h1 className="text-2xl font-bold">Collections</h1><p className="text-muted-foreground mt-2">Coming soon...</p></div>,
});

const seriesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/series',
  component: () => <div className="text-foreground"><h1 className="text-2xl font-bold">Series</h1><p className="text-muted-foreground mt-2">Coming soon...</p></div>,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: SettingsPage,
});

export const routeTree = rootRoute.addChildren([
  indexRoute,
  libraryRoute,
  bookDetailRoute,
  searchRoute,
  collectionsRoute,
  seriesRoute,
  settingsRoute,
]);
