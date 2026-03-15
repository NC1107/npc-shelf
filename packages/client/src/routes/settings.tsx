import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, FolderSync, Loader2, CheckCircle2, AlertCircle, Sparkles, Send, Rss, RefreshCw, Clock, XCircle, RotateCcw, FolderOpen, ChevronUp, ExternalLink } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Separator } from '../components/ui/separator';
import { DirectoryBrowser } from '../components/DirectoryBrowser';
import { api } from '../lib/api';
import { useScanStore } from '../stores/scanStore';
import type { Library as LibraryType, KindleSettings } from '@npc-shelf/shared';

interface JobSummary {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
}

interface Job {
  id: number;
  jobType: string;
  payload: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

function BackgroundJobsCard() {
  const queryClient = useQueryClient();

  const { data: summary } = useQuery({
    queryKey: ['jobs-summary'],
    queryFn: () => api.get<JobSummary>('/jobs/summary'),
    refetchInterval: (query) => {
      const s = query.state.data;
      return (s?.pending ?? 0) + (s?.processing ?? 0) > 0 ? 5000 : 30000;
    },
  });

  const hasActiveJobs = (summary?.pending ?? 0) + (summary?.processing ?? 0) > 0;

  const { data: recentJobs } = useQuery({
    queryKey: ['jobs-recent'],
    queryFn: () => api.get<{ items: Job[] }>('/jobs?pageSize=10'),
    refetchInterval: hasActiveJobs ? 5000 : 30000,
  });

  const retryJob = useMutation({
    mutationFn: (id: number) => api.post(`/jobs/${id}/retry`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs-summary'] });
      queryClient.invalidateQueries({ queryKey: ['jobs-recent'] });
    },
  });

  const purgeJobs = useMutation({
    mutationFn: () => api.delete('/jobs/purge?days=7'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs-summary'] });
      queryClient.invalidateQueries({ queryKey: ['jobs-recent'] });
    },
  });

  const statusIcon = (status: string) => {
    switch (status) {
      case 'pending': return <Clock className="h-3 w-3 text-muted-foreground" />;
      case 'processing': return <Loader2 className="h-3 w-3 animate-spin text-blue-500" />;
      case 'completed': return <CheckCircle2 className="h-3 w-3 text-green-500" />;
      case 'failed': return <XCircle className="h-3 w-3 text-destructive" />;
      default: return null;
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <RefreshCw className="h-5 w-5" />
          Background Jobs
        </CardTitle>
        <CardDescription>Monitor metadata matching and other background tasks</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {summary && (
          <div className="grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
            <div className="rounded-lg bg-muted p-2">
              <p className="text-lg font-semibold">{summary.pending}</p>
              <p className="text-xs text-muted-foreground">Pending</p>
            </div>
            <div className="rounded-lg bg-muted p-2">
              <p className="text-lg font-semibold">{summary.processing}</p>
              <p className="text-xs text-muted-foreground">Running</p>
            </div>
            <div className="rounded-lg bg-muted p-2">
              <p className="text-lg font-semibold">{summary.completed}</p>
              <p className="text-xs text-muted-foreground">Done</p>
            </div>
            <div className="rounded-lg bg-muted p-2">
              <p className="text-lg font-semibold text-destructive">{summary.failed}</p>
              <p className="text-xs text-muted-foreground">Failed</p>
            </div>
          </div>
        )}

        {recentJobs?.items && recentJobs.items.length > 0 && (
          <div className="max-h-60 overflow-y-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-background">
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th scope="col" className="p-2">Status</th>
                  <th scope="col" className="p-2">Type</th>
                  <th scope="col" className="p-2">Created</th>
                  <th scope="col" className="p-2"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {recentJobs.items.map((job) => (
                  <tr key={job.id} className="border-b last:border-0">
                    <td className="p-2">{statusIcon(job.status)}</td>
                    <td className="p-2 font-mono text-xs">{job.jobType}</td>
                    <td className="p-2 text-xs text-muted-foreground">
                      {new Date(job.createdAt).toLocaleString()}
                    </td>
                    <td className="p-2">
                      {job.status === 'failed' && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => retryJob.mutate(job.id)}
                          disabled={retryJob.isPending}
                          aria-label="Retry job"
                          title={job.error || 'Retry'}
                        >
                          <RotateCcw className="h-3 w-3" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={() => purgeJobs.mutate()}
            disabled={purgeJobs.isPending}
          >
            {purgeJobs.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
            Purge Old Jobs
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function SettingsPage() {
  const queryClient = useQueryClient();
  const [showAddForm, setShowAddForm] = useState(false);
  const [newLibName, setNewLibName] = useState('');
  const [newLibPath, setNewLibPath] = useState('');
  const [newLibType, setNewLibType] = useState<'ebook' | 'audiobook' | 'mixed'>('mixed');
  const [browsing, setBrowsing] = useState(false);
  const [hardcoverToken, setHardcoverToken] = useState('');
  const [tokenSaved, setTokenSaved] = useState(false);

  // Scan store
  const { activeScanLibraryId, scanStatus, startScan } = useScanStore();

  const { data: libraries } = useQuery({
    queryKey: ['libraries'],
    queryFn: () => api.get<LibraryType[]>('/libraries'),
  });

  // Check if Hardcover token is already configured
  const { data: settings } = useQuery({
    queryKey: ['app-settings'],
    queryFn: () => api.get<{ hardcoverApiToken?: string; metadataAutoMatch?: string }>('/settings'),
  });

  const hasToken = !!settings?.hardcoverApiToken;

  const addLibrary = useMutation({
    mutationFn: (lib: { name: string; path: string; type: string }) =>
      api.post('/libraries', lib),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['libraries'] });
      setNewLibName('');
      setNewLibPath('');
      setShowAddForm(false);
    },
  });

  const deleteLibrary = useMutation({
    mutationFn: (id: number) => api.delete(`/libraries/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['libraries'] }),
  });

  const scanLibrary = useMutation({
    mutationFn: (id: number) => api.post(`/libraries/${id}/scan`),
    onSuccess: (_data, id) => {
      startScan(id);
    },
  });

  const isScanning = scanStatus?.status === 'scanning' || scanStatus?.status === 'pending';

  const [kindleEmail, setKindleEmail] = useState('');
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('587');
  const [smtpUser, setSmtpUser] = useState('');
  const [smtpPass, setSmtpPass] = useState('');
  const [fromEmail, setFromEmail] = useState('');

  const { data: kindleSettings } = useQuery({
    queryKey: ['kindle-settings'],
    queryFn: () => api.get<Partial<KindleSettings>>('/kindle/settings'),
  });

  useEffect(() => {
    if (kindleSettings) {
      setKindleEmail(kindleSettings.kindleEmail || '');
      setSmtpHost(kindleSettings.smtpHost || '');
      setSmtpPort(String(kindleSettings.smtpPort || 587));
      setSmtpUser(kindleSettings.smtpUser || '');
      setFromEmail(kindleSettings.fromEmail || '');
    }
  }, [kindleSettings]);

  const saveKindleSettings = useMutation({
    mutationFn: (data: Partial<KindleSettings>) => api.put('/kindle/settings', data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['kindle-settings'] }),
  });

  const saveHardcoverToken = useMutation({
    mutationFn: (token: string) =>
      api.put('/settings', { hardcoverApiToken: token }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['app-settings'] });
      setHardcoverToken('');
      setTokenSaved(true);
      setTimeout(() => setTokenSaved(false), 3000);
    },
  });

  const matchAllBooks = useMutation({
    mutationFn: () => api.post('/metadata/match-all'),
  });

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      {/* Libraries */}
      <Card>
        <CardHeader>
          <CardTitle>Libraries</CardTitle>
          <CardDescription>Manage your book and audiobook directories</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {libraries && libraries.length > 0 && (
            <div className="space-y-2">
              {libraries.map((lib) => (
                <div key={lib.id} className="rounded-lg border p-3">
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{lib.name}</p>
                      <p className="truncate text-sm text-muted-foreground">{lib.path}</p>
                      <p className="text-xs text-muted-foreground">
                        Type: {lib.type} · Last scanned: {lib.lastScannedAt ? new Date(lib.lastScannedAt).toLocaleString() : 'Never'}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => scanLibrary.mutate(lib.id)}
                      disabled={isScanning && activeScanLibraryId === lib.id}
                    >
                      {isScanning && activeScanLibraryId === lib.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <FolderSync className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => deleteLibrary.mutate(lib.id)}
                      disabled={isScanning && activeScanLibraryId === lib.id}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>

                  {/* Scan progress (inline) */}
                  {activeScanLibraryId === lib.id && scanStatus && scanStatus.status !== 'idle' && (
                    <div className="mt-3 space-y-2">
                      {scanStatus.filesFound > 0 && (
                        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full bg-primary transition-all"
                            style={{
                              width: `${Math.round((scanStatus.filesProcessed / scanStatus.filesFound) * 100)}%`,
                            }}
                          />
                        </div>
                      )}

                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {scanStatus.status === 'scanning' && (
                          <>
                            <Loader2 className="h-3 w-3 animate-spin" />
                            Scanning... {scanStatus.filesProcessed}/{scanStatus.filesFound} files
                            {scanStatus.booksAdded > 0 && ` · ${scanStatus.booksAdded} books added`}
                          </>
                        )}
                        {scanStatus.status === 'pending' && (
                          <>
                            <Loader2 className="h-3 w-3 animate-spin" />
                            Scan queued...
                          </>
                        )}
                        {scanStatus.status === 'complete' && (
                          <>
                            <CheckCircle2 className="h-3 w-3 text-green-500" />
                            Scan complete: {scanStatus.booksAdded} added, {scanStatus.booksUpdated} updated
                          </>
                        )}
                        {scanStatus.status === 'error' && (
                          <>
                            <AlertCircle className="h-3 w-3 text-destructive" />
                            Scan failed
                          </>
                        )}
                      </div>

                      {scanStatus.errors.length > 0 && (
                        <div className="max-h-24 overflow-y-auto rounded bg-muted p-2 text-xs text-muted-foreground">
                          {scanStatus.errors.slice(0, 10).map((err, i) => (
                            <p key={`err-${i}`}>{err}</p> // NOSONAR - error strings may not be unique
                          ))}
                          {scanStatus.errors.length > 10 && (
                            <p>...and {scanStatus.errors.length - 10} more errors</p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <Separator />

          {/* Collapsible Add Library form */}
          {!showAddForm ? (
            <Button variant="outline" onClick={() => setShowAddForm(true)}>
              <Plus className="h-4 w-4" />
              Add Library
            </Button>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Add Library</p>
                <Button variant="ghost" size="sm" onClick={() => setShowAddForm(false)}>
                  <ChevronUp className="h-4 w-4" />
                </Button>
              </div>
              <label htmlFor="lib-name" className="text-sm font-medium">Library name</label>
              <Input
                id="lib-name"
                placeholder="Library name"
                value={newLibName}
                onChange={(e) => setNewLibName(e.target.value)}
              />
              <label htmlFor="lib-path" className="text-sm font-medium">Library path</label>
              <div className="flex gap-2">
                <Input
                  id="lib-path"
                  placeholder="Path (e.g. /libraries/ebooks)"
                  value={newLibPath}
                  onChange={(e) => setNewLibPath(e.target.value)}
                  className="flex-1"
                />
                <Button variant="outline" size="icon" onClick={() => setBrowsing(true)} title="Browse directories">
                  <FolderOpen className="h-4 w-4" />
                </Button>
              </div>
              <label htmlFor="lib-type" className="text-sm font-medium">Library type</label>
              <select
                id="lib-type"
                value={newLibType}
                onChange={(e) => setNewLibType(e.target.value as 'ebook' | 'audiobook' | 'mixed')}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="mixed">Mixed</option>
                <option value="ebook">Ebook</option>
                <option value="audiobook">Audiobook</option>
              </select>
              <Button
                onClick={() => addLibrary.mutate({ name: newLibName, path: newLibPath, type: newLibType })}
                disabled={!newLibName || !newLibPath || addLibrary.isPending}
              >
                {addLibrary.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                <Plus className="h-4 w-4" />
                Add Library
              </Button>
              {addLibrary.isError && (
                <p className="text-sm text-destructive">{(addLibrary.error as Error).message}</p>
              )}
            </div>
          )}

          <DirectoryBrowser
            open={browsing}
            onOpenChange={setBrowsing}
            onSelect={(path) => setNewLibPath(path)}
          />
        </CardContent>
      </Card>

      {/* Metadata */}
      <Card>
        <CardHeader>
          <CardTitle>Metadata</CardTitle>
          <CardDescription>Configure metadata enrichment via Hardcover.app</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Automatically match your books with metadata from Hardcover.app to get covers, descriptions, and series info.
              You'll need a free API token from{' '}
              <a href="https://hardcover.app/account/api" target="_blank" rel="noopener noreferrer" className="text-primary underline">
                hardcover.app/account/api
              </a>
            </p>

            {/* Token status indicator */}
            {hasToken && (
              <div className="flex items-center gap-2 text-sm text-green-600">
                <CheckCircle2 className="h-4 w-4" />
                API token configured
              </div>
            )}

            <Input
              placeholder="Hardcover API token"
              value={hardcoverToken}
              onChange={(e) => setHardcoverToken(e.target.value)}
              type="password"
            />
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => saveHardcoverToken.mutate(hardcoverToken)}
                disabled={saveHardcoverToken.isPending || !hardcoverToken}
              >
                {saveHardcoverToken.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Save Token
              </Button>
              <Button
                onClick={() => matchAllBooks.mutate()}
                disabled={matchAllBooks.isPending}
              >
                {matchAllBooks.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                <Sparkles className="h-4 w-4" />
                Match All Books
              </Button>
            </div>

            <Separator />

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Auto-match metadata on scan</p>
                <p className="text-xs text-muted-foreground">Automatically search for metadata when new books are found during a scan</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings?.metadataAutoMatch !== 'false'}
                  onChange={(e) => {
                    api.put('/settings', { metadataAutoMatch: e.target.checked ? 'true' : 'false' })
                      .then(() => queryClient.invalidateQueries({ queryKey: ['app-settings'] }));
                  }}
                  className="sr-only peer"
                  aria-label="Auto-match metadata on scan"
                />
                <div className="w-9 h-5 bg-muted rounded-full peer peer-checked:bg-primary transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-background after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4" />
              </label>
            </div>
            {tokenSaved && (
              <p className="text-sm text-green-600">Token saved.</p>
            )}
            {matchAllBooks.isSuccess && (
              <p className="text-sm text-green-600">Metadata matching queued. Books will be enriched in the background.</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Kindle */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Send className="h-5 w-5" />
            Send to Kindle
          </CardTitle>
          <CardDescription>Configure SMTP and Kindle email for book delivery</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Setup guide */}
          <div className="rounded-lg bg-muted p-3 text-xs space-y-1">
            <p className="font-medium">Setup Guide:</p>
            <ol className="list-decimal list-inside space-y-1">
              <li>
                Find your Kindle email:{' '}
                <a
                  href="https://www.amazon.com/hz/mycd/myx#/home/settings/pdoc"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline inline-flex items-center gap-0.5"
                >
                  Amazon Devices <ExternalLink className="h-2.5 w-2.5" />
                </a>
              </li>
              <li>Add your From email to Amazon's Approved Senders list</li>
              <li>
                Gmail: use{' '}
                <a
                  href="https://myaccount.google.com/apppasswords"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline inline-flex items-center gap-0.5"
                >
                  App Password <ExternalLink className="h-2.5 w-2.5" />
                </a>
                {' '}(smtp.gmail.com, port 587)
              </li>
              <li>
                Outlook: use{' '}
                <a
                  href="https://account.microsoft.com/security"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline inline-flex items-center gap-0.5"
                >
                  App Password <ExternalLink className="h-2.5 w-2.5" />
                </a>
                {' '}(smtp.office365.com, port 587)
              </li>
            </ol>
          </div>

          <div className="space-y-3">
            <label htmlFor="kindle-email" className="text-sm font-medium">Kindle email</label>
            <Input
              id="kindle-email"
              placeholder="Kindle email (e.g. yourname@kindle.com)"
              value={kindleEmail}
              onChange={(e) => setKindleEmail(e.target.value)}
            />
            <Separator />
            <p className="text-xs font-medium text-muted-foreground">SMTP Settings</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label htmlFor="smtp-host" className="text-xs font-medium">SMTP host</label>
                <Input id="smtp-host" placeholder="SMTP host" value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} />
              </div>
              <div className="space-y-1">
                <label htmlFor="smtp-port" className="text-xs font-medium">SMTP port</label>
                <Input id="smtp-port" placeholder="SMTP port" value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} />
              </div>
              <div className="space-y-1">
                <label htmlFor="smtp-user" className="text-xs font-medium">SMTP username</label>
                <Input id="smtp-user" placeholder="SMTP username" value={smtpUser} onChange={(e) => setSmtpUser(e.target.value)} />
              </div>
              <div className="space-y-1">
                <label htmlFor="smtp-pass" className="text-xs font-medium">SMTP password</label>
                <Input id="smtp-pass" placeholder="SMTP password" type="password" value={smtpPass} onChange={(e) => setSmtpPass(e.target.value)} />
              </div>
            </div>
            <label htmlFor="from-email" className="text-sm font-medium">From email</label>
            <Input id="from-email" placeholder="From email" value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} />
            <Button
              onClick={() => saveKindleSettings.mutate({
                kindleEmail,
                smtpHost,
                smtpPort: parseInt(smtpPort),
                smtpUser,
                smtpPass: smtpPass || undefined,
                fromEmail,
              })}
              disabled={saveKindleSettings.isPending}
            >
              {saveKindleSettings.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Save Kindle Settings
            </Button>
            {saveKindleSettings.isSuccess && (
              <p className="text-sm text-green-600">Kindle settings saved.</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Background Jobs */}
      <BackgroundJobsCard />

      {/* OPDS */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Rss className="h-5 w-5" />
            OPDS Catalog
          </CardTitle>
          <CardDescription>Access your library from e-reader apps like KOReader</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Your OPDS catalog is available at:
          </p>
          <code className="block rounded bg-muted px-3 py-2 text-sm">
            {window.location.origin}/opds
          </code>
          <p className="text-xs text-muted-foreground">
            Use your NPC-Shelf username and password for HTTP Basic authentication.
            Configure this URL in your e-reader app's OPDS catalog settings.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
