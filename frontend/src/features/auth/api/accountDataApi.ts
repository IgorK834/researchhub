import { apiClient } from '../../../shared/api';
import { primeCsrfToken } from './authApi';

export interface ErasureReceipt {
  readonly jobId: string;
  readonly receipt: string;
  readonly status: string;
  readonly policyVersion: string;
  readonly backupStatus: 'OUTSIDE_LIVE_STORE_SCOPE';
}
export interface ErasureStatus {
  readonly jobId: string;
  readonly status: 'PENDING' | 'RUNNING' | 'SUCCEEDED';
  readonly requestedAt: string;
  readonly liveErasedAt: string | null;
  readonly attempts: number;
  readonly errorCode: string | null;
  readonly backupStatus: 'OUTSIDE_LIVE_STORE_SCOPE';
}
export async function deleteAccount(password: string): Promise<ErasureReceipt> {
  await primeCsrfToken();
  return apiClient.delete('/api/account', { body: { password } });
}
export const fetchErasureStatus = (
  receipt: ErasureReceipt,
  signal?: AbortSignal,
): Promise<ErasureStatus> =>
  apiClient.get(`/api/account/deletions/${encodeURIComponent(receipt.jobId)}`, {
    headers: { 'X-Erasure-Receipt': receipt.receipt },
    signal,
  });
export async function downloadAccountData(): Promise<void> {
  const blob = await apiClient.getBlob('/api/account/export', {
    accept: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = 'account.json';
    link.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
/** Remove this browser's ResearchHub CRDT copies. Offline devices remain outside the live-store scope. */
export async function clearResearchhubOfflineData(): Promise<boolean> {
  if (typeof indexedDB === 'undefined' || typeof indexedDB.databases !== 'function')
    return false;
  try {
    const databases = await indexedDB.databases();
    await Promise.all(
      databases
        .filter((db) => db.name?.startsWith('researchhub:'))
        .map(
          (db) =>
            new Promise<void>((resolve, reject) => {
              const request = indexedDB.deleteDatabase(db.name!);
              request.onsuccess = () => resolve();
              request.onerror = () => reject(request.error);
              request.onblocked = () =>
                reject(
                  new Error('Close other ResearchHub tabs to clear offline copies.'),
                );
            }),
        ),
    );
    return true;
  } catch {
    return false;
  }
}
