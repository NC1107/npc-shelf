import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { BookOpen, Library, Headphones, Clock, Users, ArrowRight, Play, AlertCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Progress } from '../components/ui/progress';
import { BookCard } from '../components/books/BookCard';
import { api } from '../lib/api';
import type { PaginatedResponse, Book } from '@npc-shelf/shared';
import type { LucideIcon } from 'lucide-react';

/** Book with optional fields returned by the list endpoint. */
interface BookListItem extends Book {
  authors?: { author: { name: string } }[];
  formats?: string[];
  progressPercent?: number;
}

interface InProgressBook extends Book {
  progressType: 'reading' | 'listening';
  progressPercent: number;
}

interface LibraryStats {
  totalBooks: number;
  totalAuthors: number;
  ebookCount: number;
  audiobookCount: number;
  inProgress: number;
  needsReviewCount: number;
}

export function DashboardPage() {
  const { data: stats } = useQuery({
    queryKey: ['book-stats'],
    queryFn: () => api.get<LibraryStats>('/books/stats'),
  });

  const { data: inProgress } = useQuery({
    queryKey: ['books', 'in-progress'],
    queryFn: () => api.get<InProgressBook[]>('/books/in-progress'),
  });

  const { data: recentBooks } = useQuery({
    queryKey: ['books', 'recent'],
    queryFn: () => api.get<PaginatedResponse<BookListItem>>('/books?sortBy=createdAt&sortOrder=desc&pageSize=12'),
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground mt-1">Welcome to NPC-Shelf</p>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard
          title="Total Books"
          value={stats?.totalBooks ?? 0}
          icon={BookOpen}
        />
        <StatCard
          title="Ebooks"
          value={stats?.ebookCount ?? 0}
          icon={BookOpen}
        />
        <StatCard
          title="Audiobooks"
          value={stats?.audiobookCount ?? 0}
          icon={Headphones}
        />
        <StatCard
          title="Authors"
          value={stats?.totalAuthors ?? 0}
          icon={Users}
        />
        <StatCard
          title="In Progress"
          value={stats?.inProgress ?? 0}
          icon={Clock}
        />
      </div>

      {/* Alerts */}
      {((stats?.needsReviewCount ?? 0) > 0) && (
        <div className="flex flex-wrap gap-3">
          {(stats?.needsReviewCount ?? 0) > 0 && (
            <Link to="/library" className="flex items-center gap-2 rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-2.5 text-sm transition-colors hover:bg-yellow-100 dark:border-yellow-800 dark:bg-yellow-950 dark:hover:bg-yellow-900">
              <AlertCircle className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
              <span className="text-yellow-700 dark:text-yellow-300">{stats!.needsReviewCount} book{stats!.needsReviewCount !== 1 ? 's' : ''} need review</span>
            </Link>
          )}
        </div>
      )}

      {/* Continue Reading/Listening */}
      {inProgress && inProgress.length > 0 && (
        <section>
          <h2 className="mb-4 text-xl font-semibold">Continue</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {inProgress.map((book) => (
              <Link key={book.id} to="/library/$bookId" params={{ bookId: String(book.id) }} className="group block">
                <div className="relative overflow-hidden rounded-lg bg-muted aspect-[2/3]">
                  {book.coverPath ? (
                    <img
                      src={`/api/books/${book.id}/cover/thumb?v=${book.updatedAt}`}
                      alt={book.title}
                      className="h-full w-full object-cover transition-transform group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      {book.progressType === 'listening' ? (
                        <Headphones className="h-8 w-8 text-muted-foreground" />
                      ) : (
                        <BookOpen className="h-8 w-8 text-muted-foreground" />
                      )}
                    </div>
                  )}
                  {/* Resume overlay */}
                  <div className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all group-hover:bg-black/40 group-hover:opacity-100">
                    <Play className="h-10 w-10 text-white" />
                  </div>
                </div>
                <div className="mt-2">
                  <Progress value={book.progressPercent * 100} className="h-1.5" />
                  <p className="mt-1 truncate text-sm font-medium">{book.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {Math.round(book.progressPercent * 100)}% {book.progressType === 'listening' ? 'listened' : 'read'}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Recently Added */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">Recently Added</h2>
          {recentBooks?.items && recentBooks.items.length > 0 && (
            <Link
              to="/library"
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              View all
              <ArrowRight className="h-4 w-4" />
            </Link>
          )}
        </div>
        {recentBooks?.items && recentBooks.items.length > 0 ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {recentBooks.items.map((book) => (
              <BookCard key={book.id} book={book} view="grid" />
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Library className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-lg font-medium">No books yet</p>
              <p className="text-sm text-muted-foreground mt-1">
                Add a library in{' '}
                <Link to="/settings" className="text-primary hover:underline">
                  Settings
                </Link>{' '}
                to get started
              </p>
            </CardContent>
          </Card>
        )}
      </section>

    </div>
  );
}

function StatCard({ title, value, icon: Icon }: { title: string; value: number; icon: LucideIcon }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
      </CardContent>
    </Card>
  );
}
