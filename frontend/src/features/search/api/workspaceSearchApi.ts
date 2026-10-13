import { apiClient } from '../../../shared/api';

export type WorkspaceSearchType =
  'DOCUMENT' | 'SOURCE' | 'CONVERSATION' | 'COMMENT' | 'ANALYSIS';

export interface WorkspaceSearchResult {
  readonly type: WorkspaceSearchType;
  readonly id: string;
  readonly title: string;
  readonly snippet: string;
  readonly location: string;
  readonly sourceVersion: string | null;
  readonly updatedAt: string;
}

export interface WorkspaceSearchPage {
  readonly items: readonly WorkspaceSearchResult[];
  readonly nextCursor: string | null;
}

export function searchWorkspace(
  workspaceId: string,
  query: string,
  types: readonly WorkspaceSearchType[],
  cursor?: string,
  signal?: AbortSignal,
): Promise<WorkspaceSearchPage> {
  const parameters = new URLSearchParams({ q: query, limit: '20' });
  if (types.length) parameters.set('types', types.join(','));
  if (cursor) parameters.set('cursor', cursor);
  return apiClient.get(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/search?${parameters.toString()}`,
    { ...(signal === undefined ? {} : { signal }) },
  );
}
