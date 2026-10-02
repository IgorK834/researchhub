import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';

import { describeError } from '../../../shared/api';
import { DataTable, type TableColumn } from '../../../shared/components/content';
import type { WorkspaceSource } from '../api/sourceApi';
import { sourceContentPath } from '../api/sourceApi';
import { SOURCE_STATUS_LABELS, type SourceStatus } from '../api/sourceTypes';
import { useSourcesQuery } from '../api/useSources';

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${String(bytes)} B`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(
    new Date(value),
  );
}

const STATUS_STYLE = {
  display: 'inline-block',
  border: '1px solid currentColor',
  borderRadius: '1rem',
  padding: '0.1rem 0.5rem',
} as const;

const STATUS_COLORS: Readonly<Record<SourceStatus, string>> = {
  UPLOADED: 'var(--color-text-secondary)',
  PROCESSING: 'var(--color-warning-ink)',
  READY: 'var(--color-success-ink)',
  FAILED: 'var(--color-error-ink)',
};

/** Every workspace member can see and download the immutable research inputs. */
export function SourceList({
  workspaceId,
  uploaderNames,
}: {
  readonly workspaceId: string;
  readonly uploaderNames: ReadonlyMap<string, string>;
}): ReactElement {
  const {
    data: sources,
    error,
    isPending,
    isFetching,
    refetch,
  } = useSourcesQuery(workspaceId);

  const columns: readonly TableColumn<WorkspaceSource>[] = [
    {
      id: 'name',
      header: 'Name',
      rowHeader: true,
      render: (source) => (
        <>
          <Link to={`/app/workspaces/${workspaceId}/sources/${source.id}`}>
            {source.displayName}
          </Link>
          <p>
            {source.sourceType}, {formatBytes(source.sizeBytes)}
          </p>
          {source.failureSummary === null ? null : (
            <p>Failure: {source.failureSummary}</p>
          )}
        </>
      ),
    },
    {
      id: 'uploader',
      header: 'Uploaded by',
      priority: 'metadata',
      render: (source) => uploaderNames.get(source.uploadedBy) ?? source.uploadedBy,
    },
    {
      id: 'date',
      header: 'Date',
      priority: 'metadata',
      render: (source) => (
        <time dateTime={source.createdAt}>{formatDate(source.createdAt)}</time>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      render: (source) => (
        <span
          aria-label={`Source status: ${SOURCE_STATUS_LABELS[source.status]}`}
          style={{ ...STATUS_STYLE, color: STATUS_COLORS[source.status] }}
        >
          {SOURCE_STATUS_LABELS[source.status]}
        </span>
      ),
    },
    {
      id: 'actions',
      header: 'Actions',
      render: (source) => (
        <a href={sourceContentPath(workspaceId, source.id)} download={source.displayName}>
          Download
        </a>
      ),
    },
  ];
  return (
    <section aria-labelledby="workspace-sources-heading">
      <h2 id="workspace-sources-heading">Sources</h2>
      <button
        type="button"
        disabled={isFetching}
        onClick={() => {
          void refetch();
        }}
      >
        Refresh sources
      </button>
      {isPending ? (
        <p role="status" aria-live="polite">
          Loading sources…
        </p>
      ) : null}
      {error !== null ? (
        <p role="alert">Could not load the sources: {describeError(error)}</p>
      ) : null}
      {sources !== undefined && error === null ? (
        sources.length === 0 ? (
          <p>No sources yet.</p>
        ) : (
          <DataTable
            columns={columns}
            rows={sources}
            rowKey={(source) => source.id}
            caption="Workspace sources"
          />
        )
      ) : null}
    </section>
  );
}
