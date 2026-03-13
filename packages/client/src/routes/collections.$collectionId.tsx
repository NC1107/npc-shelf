import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, Link } from '@tanstack/react-router';
import { ArrowLeft, X } from 'lucide-react';
import { Button } from '../components/ui/button';
import { BookCard } from '../components/books/BookCard';
import { api } from '../lib/api';

export function CollectionDetailPage() {
  const { collectionId } = useParams({ strict: false }) as { collectionId: string };
  const queryClient = useQueryClient();

  const { data: collection, isLoading } = useQuery({
    queryKey: ['collection', collectionId],
    queryFn: () => api.get<any>(`/collections/${collectionId}`),
    enabled: !!collectionId,
  });

  const removeBook = useMutation({
    mutationFn: (bookId: number) =>
      api.delete(`/collections/${collectionId}/books/${bookId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['collection', collectionId] }),
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-4 w-32 animate-pulse rounded bg-muted" />
        <div className="h-8 w-64 animate-pulse rounded bg-muted" />
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-72 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      </div>
    );
  }

  if (!collection) {
    return <p className="text-muted-foreground">Collection not found.</p>;
  }

  return (
    <div className="space-y-6">
      <Link
        to="/collections"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Collections
      </Link>

      <div>
        <h1 className="text-2xl font-bold">{collection.name}</h1>
        {collection.description && (
          <p className="mt-1 text-muted-foreground">{collection.description}</p>
        )}
      </div>

      {collection.books && collection.books.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {collection.books.map((book: any) => (
            <div key={book.id} className="group relative">
              <BookCard book={book} />
              <Button
                variant="destructive"
                size="icon"
                className="absolute right-2 top-2 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => removeBook.mutate(book.id)}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <p className="py-8 text-center text-muted-foreground">
          No books in this collection yet. Add books from the book detail page.
        </p>
      )}
    </div>
  );
}
