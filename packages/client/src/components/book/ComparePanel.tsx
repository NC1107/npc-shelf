import { ArrowLeft, Copy } from 'lucide-react';
import { Button } from '../ui/button';
import { Separator } from '../ui/separator';
import type { MetadataSearchResult } from '@npc-shelf/shared';

interface ComparePanelProps {
  editData: Record<string, any>;
  setEditData: (data: Record<string, any>) => void;
  remote: MetadataSearchResult;
  onApplyAll: () => void;
}

interface CompareFieldProps {
  label: string;
  localValue: string;
  remoteValue: string;
  onApply: () => void;
}

function CompareField({ label, localValue, remoteValue, onApply }: CompareFieldProps) {
  const differs = localValue !== remoteValue && remoteValue;

  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-2">
      <div className="min-w-0">
        <span className="text-xs text-muted-foreground">{label} (local)</span>
        <p className="text-sm truncate">{localValue || <span className="italic text-muted-foreground">empty</span>}</p>
      </div>
      <div className="flex items-center pt-4">
        {differs ? (
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onApply} aria-label={`Copy ${label} from Hardcover`}>
            <ArrowLeft className="h-3 w-3" />
          </Button>
        ) : (
          <div className="h-6 w-6" />
        )}
      </div>
      <div className={`min-w-0 rounded px-2 py-0.5 ${differs ? 'bg-amber-50 dark:bg-amber-950/30' : ''}`}>
        <span className="text-xs text-muted-foreground">{label} (Hardcover)</span>
        <p className="text-sm truncate">{remoteValue || <span className="italic text-muted-foreground">empty</span>}</p>
      </div>
    </div>
  );
}

export function ComparePanel({ editData, setEditData, remote, onApplyAll }: ComparePanelProps) {
  const applyField = (field: string, value: any) => {
    setEditData({ ...editData, [field]: value });
  };

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Compare with Hardcover
        </h3>
        <Button size="sm" variant="outline" onClick={onApplyAll}>
          <Copy className="h-3 w-3" />
          Apply All
        </Button>
      </div>

      <Separator />

      <CompareField
        label="Title"
        localValue={editData.title || ''}
        remoteValue={remote.title || ''}
        onApply={() => applyField('title', remote.title)}
      />

      <CompareField
        label="Subtitle"
        localValue={editData.subtitle || ''}
        remoteValue={remote.subtitle || ''}
        onApply={() => applyField('subtitle', remote.subtitle || '')}
      />

      <CompareField
        label="Description"
        localValue={(editData.description || '').slice(0, 80) + ((editData.description?.length || 0) > 80 ? '...' : '')}
        remoteValue={(remote.description || '').slice(0, 80) + ((remote.description?.length || 0) > 80 ? '...' : '')}
        onApply={() => applyField('description', remote.description || '')}
      />

      <CompareField
        label="Authors"
        localValue={(editData.authors || []).map((a: any) => a.name).join(', ')}
        remoteValue={(remote.authors || []).join(', ')}
        onApply={() => applyField('authors', (remote.authors || []).map((name: string) => ({ name, role: 'author' })))}
      />

      <CompareField
        label="Series"
        localValue={(editData.series || []).map((s: any) => `${s.name}${s.position ? ` #${s.position}` : ''}`).join(', ')}
        remoteValue={remote.series ? `${remote.series}${remote.seriesPosition ? ` #${remote.seriesPosition}` : ''}` : ''}
        onApply={() => applyField('series', remote.series ? [{ name: remote.series, position: remote.seriesPosition }] : [])}
      />

      <CompareField
        label="Publisher"
        localValue={editData.publisher || ''}
        remoteValue="" // Hardcover doesn't provide publisher in search results
        onApply={() => {}}
      />

      <CompareField
        label="Published"
        localValue={editData.publishDate || ''}
        remoteValue={remote.publishDate || ''}
        onApply={() => applyField('publishDate', remote.publishDate || '')}
      />

      <CompareField
        label="Pages"
        localValue={String(editData.pageCount || '')}
        remoteValue={String(remote.pageCount || '')}
        onApply={() => applyField('pageCount', remote.pageCount)}
      />

      <CompareField
        label="ISBN-13"
        localValue={editData.isbn13 || ''}
        remoteValue={remote.isbn13 || ''}
        onApply={() => applyField('isbn13', remote.isbn13 || '')}
      />

      <CompareField
        label="ISBN-10"
        localValue={editData.isbn10 || ''}
        remoteValue={remote.isbn10 || ''}
        onApply={() => applyField('isbn10', remote.isbn10 || '')}
      />

      {/* Cover comparison */}
      {remote.coverUrl && (
        <>
          <Separator />
          <div className="flex items-center gap-4">
            <span className="text-xs text-muted-foreground">Cover (Hardcover)</span>
            <img src={remote.coverUrl} alt="Hardcover cover" className="h-20 w-14 rounded object-cover" />
          </div>
        </>
      )}
    </div>
  );
}
