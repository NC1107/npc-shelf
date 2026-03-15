import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { BookOpen, Library, Headphones, Clock, Users, ArrowRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
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

interface LibraryStats {
  totalBooks: number;
  totalAuthors: number;
  ebookCount: number;
  audiobookCount: number;
  inProgress: number;
}

export function DashboardPage() {
  const { data: stats } = useQuery({
    queryKey: ['book-stats'],
    queryFn: () => api.get<LibraryStats>('/books/stats'),
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
