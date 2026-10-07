import { apiClient, CSRF_PRIMING_PATH } from '../../../shared/api';

export interface ExternalResult {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
}
export interface ExternalSearch {
  readonly id: string;
  readonly workspaceId: string;
  readonly evidenceType: 'EXTERNAL_WEB';
  readonly provider: string;
  readonly query: string;
  readonly searchedBy: string;
  readonly searchedAt: string;
  readonly results: readonly ExternalResult[];
}
export interface ExternalReference extends ExternalResult {
  readonly workspaceId: string;
  readonly evidenceType: 'EXTERNAL_WEB';
  readonly provider: string;
  readonly query: string;
  readonly searchId: string;
  readonly resultId: string;
  readonly searchedBy: string;
  readonly discoveredAt: string;
  readonly recordedBy: string;
  readonly recordedAt: string;
  readonly snapshotSha256: string;
}
export interface ExternalPage {
  readonly items: readonly ExternalReference[];
  readonly totalElements: number;
  readonly page: number;
  readonly size: number;
  readonly hasNext: boolean;
}
const path = (workspaceId: string): string =>
  `/api/workspaces/${encodeURIComponent(workspaceId)}/external-sources`;
export function fetchExternalAvailability(
  workspaceId: string,
  signal?: AbortSignal,
): Promise<{ readonly available: boolean; readonly provider: string }> {
  return apiClient.get(`${path(workspaceId)}/availability`, { signal });
}
export function fetchExternalSources(
  workspaceId: string,
  page = 0,
  signal?: AbortSignal,
): Promise<ExternalPage> {
  return apiClient.get(
    `${path(workspaceId)}?${new URLSearchParams({ page: String(page), size: '30' })}`,
    { signal },
  );
}
export async function searchExternalSources(
  workspaceId: string,
  query: string,
  externalSearchEnabled: boolean,
  signal?: AbortSignal,
): Promise<ExternalSearch> {
  await apiClient.get<void>(CSRF_PRIMING_PATH);
  return apiClient.post(`${path(workspaceId)}/search`, {
    body: { query, externalSearchEnabled },
    signal,
  });
}
export async function recordExternalSource(
  workspaceId: string,
  searchId: string,
  resultId: string,
): Promise<ExternalReference> {
  await apiClient.get<void>(CSRF_PRIMING_PATH);
  return apiClient.post(path(workspaceId), { body: { searchId, resultId } });
}
