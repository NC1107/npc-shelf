import { useQuery } from '@tanstack/react-query';
import { BookOpen, Library, Headphones, Clock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { api } from '../lib/api';
import type { PaginatedResponse, Book } from '@npc-shelf/shared';

export function DashboardPage() {
  const { data: recentBooks } = useQuery({
    queryKey: ['books', 'recent'],
    queryFn: () => api.get<PaginatedResponse<Book>>('/books?sortBy=createdAt&sortOrder=desc&pageSize=12'),
  });

  const { data: libraries } = useQuery({
    queryKey: ['libraries'],
    queryFn: () => api.get<any[]>('/libraries'),
  });

  const totalBooks = recentBooks?.total ?? 0;
  const totalLibraries = libraries?.length ?? 0;

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Dashboard</h1>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Books</CardTitle>
            <BookOpen className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalBooks}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Libraries</CardTitle>
            <Library className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalLibraries}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Audiobooks</CardTitle>
            <Headphones className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">0</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">In Progress</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">0</div>
          </CardContent>
        </Card>
      </div>

      {/* Recent books */}
      <div>
        <h2 className="text-xl font-semibold mb-4">Recently Added</h2>
        {recentBooks?.items && recentBooks.items.length > 0 ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {recentBooks.items.map((book) => (
              <a
                key={book.id}
                href={`/library/${book.id}`}
                className="group overflow-hidden rounded-lg border bg-card transition-colors hover:bg-accent"
              >
                <div className="aspect-[2/3] bg-muted flex items-center justify-center">
                  {book.coverPath ? (
                    <img
                      src={`/api/books/${book.id}/cover/thumb`}
                      alt={book.title}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <BookOpen className="h-8 w-8 text-muted-foreground" />
                  )}
                </div>
                <div className="p-2">
                  <p className="truncate text-sm font-medium">{book.title}</p>
                </div>
              </a>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Library className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground">No books yet. Add a library in Settings to get started.</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
