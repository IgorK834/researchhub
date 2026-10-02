import { apiClient } from '../../../shared/api';
import type { Citation } from './generationApi';

export interface CitationFragment {
  readonly workspaceId: string;
  readonly sourceId: string;
  readonly sourceVersionId: string | null;
  readonly chunkId: string;
  readonly processingVersion: string;
  readonly contentHash: string;
  readonly content: string;
}

/** Read the cited immutable retrieval set, never substitute a source's latest extraction. */
export async function fetchCitationFragment(
  citation: Citation,
  signal?: AbortSignal,
): Promise<CitationFragment> {
  const fragment = await apiClient.get<CitationFragment>(
    `/api/workspaces/${encodeURIComponent(citation.workspaceId)}/sources/${encodeURIComponent(citation.sourceId)}/retrieval/chunks/${encodeURIComponent(citation.chunkId)}?${new URLSearchParams({ processingVersion: citation.processingVersion }).toString()}`,
    { signal },
  );
  if (
    fragment.workspaceId !== citation.workspaceId ||
    fragment.sourceId !== citation.sourceId ||
    fragment.sourceVersionId !== citation.sourceVersionId ||
    fragment.chunkId !== citation.chunkId ||
    fragment.processingVersion !== citation.processingVersion ||
    fragment.contentHash !== citation.contentHash ||
    typeof fragment.content !== 'string'
  ) {
    throw new Error('The cited fragment does not match this citation.');
  }
  return fragment;
}
