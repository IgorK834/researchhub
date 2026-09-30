import type { ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { validateCitationVersion } from '../api/generationApi';

/** A cited snapshot must not silently resolve to content from a later retrieval version. */
export function CitationVersionStatus({
  workspaceId,
  sourceId,
  processingVersion,
}: {
  readonly workspaceId: string;
  readonly sourceId: string;
  readonly processingVersion: string;
}): ReactElement | null {
  const { error, isPending, data } = useQuery({
    queryKey: ['ai-citation-version', workspaceId, sourceId, processingVersion],
    queryFn: ({ signal }) =>
      validateCitationVersion(workspaceId, sourceId, processingVersion, signal),
    retry: false,
    staleTime: 0,
  });
  if (isPending) return <p role="status">Checking cited source version…</p>;
  if (error !== null || data === false)
    return (
      <p role="alert">
        The cited source version is unavailable or has changed. The preview below shows
        the current source.
      </p>
    );
  return null;
}
