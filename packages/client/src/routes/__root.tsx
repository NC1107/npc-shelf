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
import { ReadPage } from './library.$bookId.read';
import { ListenPage } from './library.$bookId.listen';
import { CollectionsPage } from './collections';
import { CollectionDetailPage } from './collections.$collectionId';
import { SeriesPage } from './series';
import { SeriesDetailPage } from './series.$seriesId';
import { DuplicatesPage } from './duplicates';
import { AuthorsPage } from './authors';

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
  component: CollectionsPage,
});

const collectionDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/collections/$collectionId',
  component: CollectionDetailPage,
});

const seriesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/series',
  component: SeriesPage,
});

const seriesDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/series/$seriesId',
  component: SeriesDetailPage,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: SettingsPage,
});

const duplicatesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/duplicates',
  component: DuplicatesPage,
});

const authorsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/authors',
  component: AuthorsPage,
});

const readRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/library/$bookId/read',
  component: ReadPage,
});

const listenRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/library/$bookId/listen',
  component: ListenPage,
});

export const routeTree = rootRoute.addChildren([
  indexRoute,
  libraryRoute,
  bookDetailRoute,
  readRoute,
  listenRoute,
  searchRoute,
  collectionsRoute,
  collectionDetailRoute,
  seriesRoute,
  seriesDetailRoute,
  settingsRoute,
  duplicatesRoute,
  authorsRoute,
]);
