import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useScanStore } from '../stores/scanStore';
import { api } from '../lib/api';
import type { ScanStatus } from '@npc-shelf/shared';

/**
 * Poll scan status when a scan is active.
 * Should be mounted in AppShell for global persistence.
 */
export function useScanPolling() {
  const { activeScanLibraryId, updateStatus, clearScan } = useScanStore();
  const queryClient = useQueryClient();
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!activeScanLibraryId) return;

    // Clear any pending clear timer
    if (clearTimerRef.current) {
      clearTimeout(clearTimerRef.current);
      clearTimerRef.current = null;
    }

    const interval = setInterval(async () => {
      try {
        const data = await api.get<ScanStatus>(`/libraries/${activeScanLibraryId}/scan/status`);
        updateStatus(data);

        if (data.status === 'complete' || data.status === 'error') {
          // Refresh relevant queries
          queryClient.invalidateQueries({ queryKey: ['libraries'] });
          queryClient.invalidateQueries({ queryKey: ['books'] });

          // Clear after delay
          clearTimerRef.current = setTimeout(() => {
            clearScan();
          }, 5000);
          clearInterval(interval);
        } else if (data.status === 'idle') {
          // No active scan — could be waiting for job to start, keep polling briefly
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
