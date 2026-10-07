import { apiClient } from '../../../shared/api';

export interface SourceTextHit {
  readonly chunk: {
    readonly chunkId: string;
    readonly workspaceId: string;
    readonly sourceId: string;
    readonly sourceVersionId: string;
    readonly content: string;
    readonly contentHash: string;
    readonly processingVersion: string;
    readonly pageStart: number | null;
    readonly pageEnd: number | null;
    readonly sectionTitle: string | null;
    readonly spans: readonly {
      readonly unitId: string;
      readonly characterStart: number;
      readonly characterEnd: number;
    }[];
  };
  readonly score: number;
  readonly vectorSimilarity: number;
  readonly lexicalScore: number;
}

/** Passage results exclusively use authorized retrieval, never filename search or web discovery. */
export async function searchSourceText(
  workspaceId: string,
  query: string,
  signal?: AbortSignal,
): Promise<readonly SourceTextHit[]> {
  const hits = await apiClient.get<readonly SourceTextHit[]>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/retrieval/search?${new URLSearchParams({ query, topK: '20' })}`,
    { ...(signal === undefined ? {} : { signal }) },
  );
  if (hits.some((hit) => hit.chunk.workspaceId !== workspaceId))
    throw new Error('Search results are outside the current workspace. Try again.');
  return hits;
}

export function passagePath(hit: SourceTextHit): string {
  const chunk = hit.chunk;
  const query = new URLSearchParams({
    version: chunk.sourceVersionId,
    processingVersion: chunk.processingVersion,
  });
  if (chunk.pageStart !== null) query.set('page', String(chunk.pageStart));
  if (chunk.spans[0]) query.set('unit', chunk.spans[0].unitId);
  return `/app/workspaces/${encodeURIComponent(chunk.workspaceId)}/sources/${encodeURIComponent(chunk.sourceId)}?${query}`;
}

export function passageLocation(hit: SourceTextHit): string {
  const { pageStart, pageEnd, sectionTitle, spans } = hit.chunk;
  if (pageStart !== null)
    return pageEnd !== null && pageEnd !== pageStart
      ? `pages ${String(pageStart)}–${String(pageEnd)}`
      : `page ${String(pageStart)}`;
  return sectionTitle ?? (spans[0] ? `location ${spans[0].unitId}` : 'Source passage');
}
