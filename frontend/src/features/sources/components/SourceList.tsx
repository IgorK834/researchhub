import { useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { describeError } from '../../../shared/api';
import { Button } from '../../../shared/components/Button';
import {
  DataTable,
  EmptyState,
  IconTile,
  type TableColumn,
} from '../../../shared/components/content';
import { Avatar, Sticker } from '../../../shared/components/identity';
import { Icon } from '../../../shared/components/icons';
import { Tabs } from '../../../shared/components/navigation';
import type { WorkspaceSource } from '../api/sourceApi';
import { sourceContentPath } from '../api/sourceApi';
import { SOURCE_TYPES, type SourceType } from '../api/sourceTypes';
import { useSourcesQuery } from '../api/useSources';
import { SourceStatusChip, SourceTypeBadge, SourceTypeTile } from './SourceVisuals';
import { SourceProgress } from './SourceProgress';
import { SourceRetry } from './SourceRetry';
import { SourceUploadForm } from './SourceUploadForm';
import { formatSourceBytes } from './sourcePresentation';
import styles from './Sources.module.css';

export interface SourceListProps {
  readonly workspaceId: string;
  readonly uploaderNames: ReadonlyMap<string, string>;
  readonly canEdit?: boolean;
  readonly archived?: boolean;
}

/** Shared library of immutable source inputs; the server rechecks membership and all writes. */
export function SourceList({
  workspaceId,
  uploaderNames,
  canEdit = false,
  archived = false,
}: SourceListProps): ReactElement {
  const {
    data: sources,
    error,
    isPending,
    isFetching,
    refetch,
  } = useSourcesQuery(workspaceId);
  const [type, setType] = useState<'ALL' | SourceType>('ALL');
  const [uploadOpen, setUploadOpen] = useState(false);
  const readyCount = sources?.filter((source) => source.status === 'READY').length;
  const rows =
    sources?.filter((source) => type === 'ALL' || source.sourceType === type) ?? [];
  const columns: readonly TableColumn<WorkspaceSource>[] = [
    {
      id: 'name',
      header: 'Name',
      rowHeader: true,
      render: (source) => (
        <div className={styles.name}>
          <SourceTypeTile sourceType={source.sourceType} />
          <div>
            <Link to={`/app/workspaces/${workspaceId}/sources/${source.id}`}>
              {source.displayName}
            </Link>
            <p>{formatSourceBytes(source.sizeBytes)}</p>
            {source.status === 'UPLOADED' || source.status === 'PROCESSING' ? (
              <SourceProgress workspaceId={workspaceId} sourceId={source.id} />
            ) : null}
            {source.status === 'FAILED' ? (
              <p className={styles.failure} title={source.failureSummary ?? undefined}>
                Failure: {source.failureSummary ?? 'Source processing failed.'}
              </p>
            ) : null}
          </div>
        </div>
      ),
    },
    {
      id: 'type',
      header: 'Type',
      render: (source) => <SourceTypeBadge sourceType={source.sourceType} />,
    },
    {
      id: 'uploader',
      header: 'Uploaded by',
      priority: 'metadata',
      render: (source) => {
        const name = uploaderNames.get(source.uploadedBy) ?? source.uploadedBy;
        return (
          <span className={styles.uploader}>
            <Avatar userId={source.uploadedBy} name={name} size="xs" />
            {name}
          </span>
        );
      },
    },
    {
      id: 'date',
      header: 'Date',
      priority: 'metadata',
      render: (source) => (
        <time dateTime={source.createdAt}>
          {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(
            new Date(source.createdAt),
          )}
        </time>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      render: (source) => <SourceStatusChip status={source.status} />,
    },
    {
      id: 'actions',
      header: 'Actions',
      render: (source) => (
        <div className={styles.actions}>
          {source.status === 'READY' ? (
            <Link
              to={`/app/workspaces/${workspaceId}/ask?askSource=${encodeURIComponent(source.id)}`}
            >
              <Icon name="sparkle" size={14} />
              Ask source
            </Link>
          ) : null}
          <Link to={`/app/workspaces/${workspaceId}/sources/${source.id}`}>
            <Icon name="external" size={14} />
            Open
          </Link>
          <a
            href={sourceContentPath(workspaceId, source.id)}
            download={source.displayName}
          >
            <Icon name="download" size={14} />
            Download
          </a>
          {source.status === 'FAILED' && canEdit ? (
            <SourceRetry workspaceId={workspaceId} sourceId={source.id} />
          ) : null}
        </div>
      ),
    },
  ];
  const collection =
    rows.length === 0 ? (
      <EmptyState
        context={type === 'ALL' ? 'Sources · empty' : `Sources · ${type}`}
        title="Bring in your research material"
        description={
          type === 'ALL'
            ? 'Add PDF, DOCX, XLSX, CSV or TXT files. AI answers can cite your sources.'
            : `No ${type} sources in this workspace yet.`
        }
        art={<IconTile icon="upload" tone="blue" size="large" />}
        actions={
          canEdit && sources?.length === 0
            ? [
                <Button key="upload" icon="upload" onClick={() => setUploadOpen(true)}>
                  Upload source
                </Button>,
              ]
            : undefined
        }
      />
    ) : (
      <div className={styles.table}>
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(source) => source.id}
          caption="Workspace sources"
        />
      </div>
    );
  return (
    <section className={styles.library} aria-labelledby="workspace-sources-heading">
      <header className={styles.header}>
        <div>
          <h1 id="workspace-sources-heading">Sources</h1>
          {sources !== undefined && error === null ? (
            <p>
              {sources.length} {sources.length === 1 ? 'source' : 'sources'} ·{' '}
              {readyCount} ready · AI answers can cite these sources
            </p>
          ) : null}
        </div>
        <div className={styles.headerActions}>
          {readyCount !== undefined && error === null ? (
            <Sticker
              tone="blue"
              icon="sparkle"
              label={`Grounded in ${readyCount} ready ${readyCount === 1 ? 'source' : 'sources'}`}
            />
          ) : null}
          {canEdit && sources?.length !== 0 ? (
            <Button icon="upload" onClick={() => setUploadOpen(true)}>
              Upload source
            </Button>
          ) : null}
        </div>
      </header>
      {archived ? (
        <p role="status">
          This workspace is archived. Its content can no longer be changed. Nothing has
          been deleted.
        </p>
      ) : null}
      {isPending ? <p role="status">Loading sources…</p> : null}
      {error !== null ? (
        <p role="alert">Could not load the sources: {describeError(error)}</p>
      ) : null}
      {sources !== undefined && error === null ? (
        <Tabs
          label="Source types"
          value={type}
          onChange={setType}
          items={(['ALL', ...SOURCE_TYPES] as const).map((value) => ({
            value,
            label: value === 'ALL' ? 'All sources' : value,
            count:
              value === 'ALL'
                ? sources.length
                : sources.filter((source) => source.sourceType === value).length,
            content: value === type ? collection : null,
          }))}
        />
      ) : null}
      <Button
        className={styles.refresh}
        variant="ghost"
        size="compact"
        icon="refresh"
        disabled={isFetching}
        onClick={() => {
          void refetch();
        }}
      >
        Refresh sources
      </Button>
      {canEdit ? (
        <SourceUploadForm
          workspaceId={workspaceId}
          open={uploadOpen}
          onClose={() => setUploadOpen(false)}
        />
      ) : null}
    </section>
  );
}
