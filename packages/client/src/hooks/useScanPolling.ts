import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useScanStore } from '../stores/scanStore';
import { api } from '../lib/api';
import type { ScanStatus } from '@npc-shelf/shared';

/**
 * Poll scan status when a scan is active.
 * On mount, checks server for any active scan (survives page refresh).
 * Should be mounted in AppShell for global persistence.
 */
export function useScanPolling() {
  const { activeScanLibraryId, updateStatus, clearScan, startScan } = useScanStore();
  const queryClient = useQueryClient();
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const checkedRef = useRef(false);

  // On mount: check if there's an active scan on the server
  useEffect(() => {
    if (checkedRef.current) return;
    checkedRef.current = true;

    api.get<{ libraryId: number; status: string } | null>('/libraries/active-scan')
      .then((data) => {
        if (data && data.libraryId && data.status !== 'idle') {
          startScan(data.libraryId);
        } else if (activeScanLibraryId) {
          // Had a persisted scan but server says nothing active — clear it
          clearScan();
        }
      })
      .catch(() => { /* ignore */ });
  }, []);

  // Poll when active
  useEffect(() => {
    if (!activeScanLibraryId) return;

    if (clearTimerRef.current) {
      clearTimeout(clearTimerRef.current);
      clearTimerRef.current = null;
    }

    const interval = setInterval(async () => {
      try {
        const data = await api.get<ScanStatus>(`/libraries/${activeScanLibraryId}/scan/status`);
        updateStatus(data);

        if (data.status === 'complete' || data.status === 'error') {
          queryClient.invalidateQueries({ queryKey: ['libraries'] });
          queryClient.invalidateQueries({ queryKey: ['books'] });

          clearTimerRef.current = setTimeout(() => {
            clearScan();
          }, 5000);
          clearInterval(interval);
        }
      } catch {
        clearInterval(interval);
      }
    }, 1000);

    return () => {
      clearInterval(interval);
    };
  }, [activeScanLibraryId, updateStatus, clearScan, queryClient]);
}
