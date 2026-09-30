import type { ReactElement } from 'react';
import { CitationVersionStatus } from '../features/ai/components/CitationVersionStatus';
import { Link, useParams, useSearchParams } from 'react-router-dom';

import { PdfSourcePreview } from '../features/sources/components/PdfSourcePreview';
import { SourceProcessing } from '../features/sources/components/SourceProcessing';
import { useCurrentUser } from '../features/auth/api/useAuth';
import { parsePdfPage } from '../features/sources/api/sourceLocations';
import { queryKeys } from '../shared/api';
import { useQueryClient } from '@tanstack/react-query';
import { SourceExtractionPreview } from '../features/sources/components/SourceExtractionPreview';
import { sourceContentPath } from '../features/sources/api/sourceApi';
import { SOURCE_STATUS_LABELS } from '../features/sources/api/sourceTypes';
import { useSourceQuery } from '../features/sources/api/useSources';
import { useWorkspaceMembersQuery } from '../features/workspaces/api/useWorkspaces';
import { describeError, hasApiErrorCode } from '../shared/api';

export function SourceDetailPage(): ReactElement {
  const { workspaceId, sourceId } = useParams<{
    workspaceId: string;
    sourceId: string;
  }>();
  if (workspaceId === undefined || sourceId === undefined) {
    return <SourceNotFound workspaceId={workspaceId} />;
  }
  return <SourceDetail workspaceId={workspaceId} sourceId={sourceId} />;
}

function SourceNotFound({
  workspaceId,
}: {
  readonly workspaceId?: string;
}): ReactElement {
  return (
    <section>
      <h1>Source not found</h1>
      <p>
        This source is not available. It may have been removed, or you may not have
        access.
      </p>
      <Link
        to={
          workspaceId === undefined ? '/app/workspaces' : `/app/workspaces/${workspaceId}`
        }
      >
        Back to the workspace
      </Link>
    </section>
  );
}

function SourceDetail({
  workspaceId,
  sourceId,
}: {
  readonly workspaceId: string;
  readonly sourceId: string;
}): ReactElement {
  const {
    data: source,
    error,
    isPending,
    refetch,
  } = useSourceQuery(workspaceId, sourceId);
  const { data: members } = useWorkspaceMembersQuery(workspaceId);
  const { data: currentUser } = useCurrentUser();
  const [search, setSearch] = useSearchParams();
  const client = useQueryClient();
  const role = members?.find((member) => member.userId === currentUser?.id)?.role;
  const onNavigate = (page: number): void => {
    const next = new URLSearchParams(search);
    next.set('page', String(page));
    next.delete('unit');
    setSearch(next);
  };

  if (error !== null && hasApiErrorCode(error, 'RESOURCE_NOT_FOUND')) {
    return <SourceNotFound workspaceId={workspaceId} />;
  }
  if (isPending) {
    return <p role="status">Loading source…</p>;
  }
  if (error !== null) {
    return <p role="alert">Could not load the source: {describeError(error)}</p>;
  }

  const uploader =
    members?.find((member) => member.userId === source.uploadedBy)?.displayName ??
    source.uploadedBy;

  return (
    <section>
      <p>
        <Link to={`/app/workspaces/${workspaceId}`}>Back to the workspace</Link>
      </p>
      <h1>{source.displayName}</h1>
      {search.get('processingVersion') ? (
        <CitationVersionStatus
          key={source.updatedAt}
          workspaceId={workspaceId}
          sourceId={sourceId}
          processingVersion={search.get('processingVersion') ?? ''}
        />
      ) : null}
      <dl>
        <dt>Type</dt>
        <dd>{source.sourceType}</dd>
        <dt>Status</dt>
        <dd>{SOURCE_STATUS_LABELS[source.status]}</dd>
        <dt>Uploaded by</dt>
        <dd>{uploader}</dd>
        <dt>Uploaded on</dt>
        <dd>
          <time dateTime={source.createdAt}>
            {new Intl.DateTimeFormat(undefined, {
              dateStyle: 'medium',
              timeStyle: 'short',
            }).format(new Date(source.createdAt))}
          </time>
        </dd>
        <dt>Size</dt>
        <dd>{source.sizeBytes.toLocaleString()} bytes</dd>
      </dl>
      {source.failureSummary === null ? null : (
        <p role="alert">Failure: {source.failureSummary}</p>
      )}
      <p>
        <a href={sourceContentPath(workspaceId, sourceId)} download={source.displayName}>
          Download source
        </a>
      </p>
      <SourceProcessing
        workspaceId={workspaceId}
        sourceId={sourceId}
        status={source.status}
        canEdit={role === 'OWNER' || role === 'EDITOR'}
      />
      {source.sourceType === 'PDF' ? (
        <PdfSourcePreview
          workspaceId={workspaceId}
          sourceId={sourceId}
          revision={source.updatedAt}
          ready={source.status === 'READY'}
          requestedPage={search.get('page')}
          onNavigate={onNavigate}
        />
      ) : null}
      {source.status === 'READY' ? (
        <SourceExtractionPreview
          workspaceId={workspaceId}
          sourceId={sourceId}
          revision={source.updatedAt}
          selectedUnit={search.get('unit')}
          selectedPage={parsePdfPage(search.get('page'))}
          selectedSheet={search.get('sheet')}
          expectedParserVersion={search.get('parserVersion')}
        />
      ) : null}
      <button
        type="button"
        onClick={() => {
          void refetch();
          void client.invalidateQueries({
            queryKey: queryKeys.sourceExtraction(workspaceId, sourceId),
          });
        }}
      >
        Refresh status
      </button>
    </section>
  );
}
