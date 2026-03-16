import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Search, Check, X, Loader2, ExternalLink } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { Separator } from '../ui/separator';
import { api } from '../../lib/api';
import type { BookDetail, MetadataSearchResult } from '@npc-shelf/shared';

type ReviewPanelProps = Readonly<{
  book: BookDetail;
  onAccept: () => void;
  onReject: () => void;
  onApplyMatch: (externalId: string) => void;
}>;

export function ReviewPanel({ book, onAccept, onReject, onApplyMatch }: ReviewPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');

  const { data: matchDetails, isLoading: detailsLoading } = useQuery({
    queryKey: ['hardcover-details', book.hardcoverId],
    queryFn: () => api.get<MetadataSearchResult>(`/metadata/details/${book.hardcoverId}`),
    enabled: !!book.hardcoverId,
    staleTime: 5 * 60 * 1000,
  });

  const { data: searchResults, refetch: doSearch, isFetching: searchFetching } = useQuery({
    queryKey: ['metadata-search', searchQuery],
    queryFn: () => api.get<{ results: MetadataSearchResult[] }>(`/metadata/search?q=${encodeURIComponent(searchQuery)}`),
    enabled: false,
  });

  const applyMutation = useMutation({
    mutationFn: (externalId: string) => api.post(`/metadata/apply/${book.id}`, { externalId }),
    onSuccess: () => onApplyMatch(''),
  });

  const handleSearch = () => {
    if (searchQuery.trim()) {
      doSearch();
    }
  };

  const breakdown = book.matchBreakdown;

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Match Review</h3>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={onAccept}>
            <Check className="h-3 w-3 mr-1" />
            Accept
          </Button>
          <Button size="sm" variant="ghost" onClick={onReject}>
            <X className="h-3 w-3 mr-1" />
            Reject
          </Button>
        </div>
      </div>

      {/* Side-by-side comparison */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Local metadata */}
        <div className="space-y-2 rounded-lg bg-muted/50 p-3">
          <p className="text-xs font-medium text-muted-foreground">Local</p>
          <p className="font-medium">{book.title}</p>
          {book.authors && book.authors.length > 0 && (
            <p className="text-sm text-muted-foreground">
              {book.authors.map(a => a.author.name).join(', ')}
            </p>
          )}
          {book.series && book.series.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {book.series.map(s => {
                const position = s.position ? ` #${s.position}` : '';
                return `${s.series.name}${position}`;
              }).join(', ')}
            </p>
          )}
        </div>

        {/* Hardcover match */}
        <div className="space-y-2 rounded-lg bg-muted/50 p-3">
          <p className="text-xs font-medium text-muted-foreground">Hardcover Match</p>
          {detailsLoading && (
            <Loader2 className="h-4 w-4 animate-spin" />
          )}
          {!detailsLoading && matchDetails && (
            <>
              <p className="font-medium">{matchDetails.title}</p>
              {matchDetails.authors && matchDetails.authors.length > 0 && (
                <p className="text-sm text-muted-foreground">{matchDetails.authors.join(', ')}</p>
              )}
              {matchDetails.series && (
                <p className="text-xs text-muted-foreground">
                  {matchDetails.series}{matchDetails.seriesPosition ? ` #${matchDetails.seriesPosition}` : ''}
                </p>
              )}
              {matchDetails.slug && (
                <a
                  href={`https://hardcover.app/books/${matchDetails.slug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  View on Hardcover <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </>
          )}
          {!detailsLoading && !matchDetails && (
            <p className="text-sm text-muted-foreground">No match details available</p>
          )}
        </div>
      </div>

      {/* Match score breakdown */}
      {breakdown && (
        <>
          <Separator />
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Match Breakdown</p>
            <div className="flex flex-wrap gap-2 text-xs">
              {breakdown.total === undefined ? (
                <>
                  <Badge variant="outline">Title: {Math.round(breakdown.titleSimilarity * 100)}%</Badge>
                  <Badge variant="outline">Author: {Math.round(breakdown.authorSimilarity * 100)}%</Badge>
                  <Badge variant="secondary">
                    Confidence: {book.matchConfidence ? `${Math.round(book.matchConfidence * 100)}%` : 'N/A'}
                  </Badge>
                </>
              ) : (
                <>
                  <Badge variant="outline">Title: {breakdown.titleScore?.toFixed(1) ?? 'N/A'}</Badge>
                  <Badge variant="outline">Author: {breakdown.authorScore?.toFixed(1) ?? 'N/A'}</Badge>
                  {(breakdown.seriesBonus ?? 0) > 0 && <Badge variant="outline">Series: +{breakdown.seriesBonus?.toFixed(1)}</Badge>}
                  <Badge variant="secondary">Total: {breakdown.total.toFixed(1)}</Badge>
                </>
              )}
            </div>
          </div>
        </>
      )}

      {/* Alternative match search */}
      <Separator />
      <div className="space-y-3">
        <p className="text-xs font-medium text-muted-foreground">Search for alternative match</p>
        <div className="flex gap-2">
          <Input
            placeholder="Search Hardcover..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            className="flex-1"
          />
          <Button size="sm" variant="outline" onClick={handleSearch} disabled={searchFetching || !searchQuery.trim()}>
            {searchFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          </Button>
        </div>

        {searchResults?.results && searchResults.results.length > 0 && (
          <div className="max-h-60 space-y-2 overflow-y-auto">
            {searchResults.results.map((result) => (
              <div
                key={result.externalId}
                className="flex items-center justify-between rounded-lg border p-2 hover:bg-muted/50"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{result.title}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {result.authors?.join(', ') || 'Unknown author'}
                    {result.publishDate && ` · ${result.publishDate.substring(0, 4)}`}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-2 shrink-0"
                  onClick={() => applyMutation.mutate(result.externalId)}
                  disabled={applyMutation.isPending}
                >
                  {applyMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Use This'}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
