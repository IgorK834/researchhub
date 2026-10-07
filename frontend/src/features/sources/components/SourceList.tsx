import { useState, type ReactElement } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { describeError } from '../../../shared/api';
import { Button } from '../../../shared/components/Button';
import {
  DataTable,
  ResponsiveFilters,
  EmptyState,
  type TableColumn,
} from '../../../shared/components/content';
import { Avatar, Sticker } from '../../../shared/components/identity';
import { Icon } from '../../../shared/components/icons';
import { Illustration } from '../../../shared/components/Illustration';
import { Tabs } from '../../../shared/components/navigation';
import type { WorkspaceSource } from '../api/sourceApi';
import { sourceContentPath } from '../api/sourceApi';
import { SOURCE_TYPES, type SourceType } from '../api/sourceTypes';
import { useSourceSearchQuery, useSourceFacetsQuery } from '../api/useSources';
import { TextField, Select } from '../../../shared/components/forms';
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
  const [search, setSearch] = useSearchParams();
  const rawType = search.get('type');
  const type = SOURCE_TYPES.includes(rawType as SourceType)
    ? (rawType as SourceType)
    : 'ALL';
  const page = Math.max(0, Math.min(1000000, Number(search.get('page')) || 0));
  const filters = {
    query: search.get('query') ?? '',
    type: type === 'ALL' ? '' : type,
    status: search.get('status') ?? '',
    uploader: search.get('uploader') ?? '',
    tag: search.get('tag') ?? '',
    collection: search.get('collection') ?? '',
    page,
  };
  const {
    data: result,
    error,
    isPending,
    isFetching,
    refetch,
  } = useSourceSearchQuery(workspaceId, filters);
  const {
    data: facets,
    error: facetsError,
    refetch: refreshFacets,
  } = useSourceFacetsQuery(workspaceId);
  const [uploadOpen, setUploadOpen] = useState(false);
  const readyCount = facets?.ready;
  const rows = result?.items ?? [];
  const total = facets?.total;
  const filtered = Boolean(
    filters.query ||
    filters.type ||
    filters.status ||
    filters.uploader ||
    filters.tag ||
    filters.collection,
  );
  const changeFilter = (key: string, value: string): void => {
    const next = new URLSearchParams(search);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setSearch(next);
  };
  const setType = (value: 'ALL' | SourceType): void =>
    changeFilter('type', value === 'ALL' ? '' : value);
  const clearFilters = (): void => {
    const next = new URLSearchParams(search);
    ['query', 'type', 'status', 'uploader', 'tag', 'collection', 'page'].forEach((key) =>
      next.delete(key),
    );
    setSearch(next);
  };
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
            {source.bibliography?.title ? <p>{source.bibliography.title}</p> : null}
            <p>{formatSourceBytes(source.sizeBytes)}</p>
            {source.tags?.length || source.collections?.length ? (
              <p>{[...(source.tags ?? []), ...(source.collections ?? [])].join(' · ')}</p>
            ) : null}
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
        title={
          total === 0 && !filtered
            ? 'Bring in your research material'
            : type !== 'ALL'
              ? `No ${type} sources`
              : 'No matching sources'
        }
        description={
          filtered && type === 'ALL'
            ? 'Try a different search or clear the filters.'
            : type === 'ALL'
              ? 'Add PDF, DOCX, XLSX, CSV or TXT files. AI answers can cite your sources.'
              : `No ${type} sources in this workspace yet.`
        }
        art={<Illustration scene={total === 0 ? 'sources' : 'search'} />}
        tone="blue"
        actions={
          canEdit && total === 0 && !filtered
            ? [
                <Button key="upload" icon="upload" onClick={() => setUploadOpen(true)}>
                  Upload source
                </Button>,
              ]
            : filtered
              ? [
                  <Button key="clear" variant="secondary" onClick={clearFilters}>
                    Show all sources
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
          {facets !== undefined && error === null && facetsError === null ? (
            <p>
              {total} {total === 1 ? 'source' : 'sources'} · {readyCount} ready · AI
              answers can cite these sources
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
          {canEdit && total !== 0 ? (
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
      {facetsError ? (
        <p role="alert">Could not load filter options: {describeError(facetsError)}</p>
      ) : null}
      <form
        className={styles.search}
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          changeFilter(
            'query',
            String(new FormData(event.currentTarget).get('query') ?? '').trim(),
          );
        }}
      >
        <TextField
          label="Search sources"
          type="search"
          placeholder="Search filename or title"
          maxLength={200}
          key={filters.query}
          name="query"
          defaultValue={filters.query}
        />
        <Button variant="secondary" type="submit" icon="search">
          Search
        </Button>
      </form>
      <ResponsiveFilters>
        <div className={styles.filters}>
          <Select
            label="Status"
            value={filters.status}
            onChange={(event) => changeFilter('status', event.target.value)}
          >
            <option value="">All statuses</option>
            {['UPLOADED', 'PROCESSING', 'READY', 'FAILED'].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
          <Select
            label="Uploaded by"
            value={filters.uploader}
            onChange={(event) => changeFilter('uploader', event.target.value)}
          >
            <option value="">Anyone</option>
            {(facets?.uploaders ?? []).map((id) => (
              <option key={id} value={id}>
                {uploaderNames.get(id) ?? id}
              </option>
            ))}
          </Select>
          <Select
            label="Tag"
            value={filters.tag}
            onChange={(event) => changeFilter('tag', event.target.value)}
          >
            <option value="">All tags</option>
            {(facets?.tags ?? []).map((tag) => (
              <option key={tag} value={tag}>
                {tag}
              </option>
            ))}
          </Select>
          {filtered ? (
            <Button variant="ghost" onClick={clearFilters}>
              Clear filters
            </Button>
          ) : null}
        </div>
      </ResponsiveFilters>
      {facets?.collections.length ? (
        <div className={styles.collections} aria-label="Source collections">
          <Button
            variant={filters.collection === '' ? 'primary' : 'secondary'}
            size="compact"
            onClick={() => changeFilter('collection', '')}
          >
            All collections
          </Button>
          {facets.collections.map((collection) => (
            <Button
              key={collection}
              variant={filters.collection === collection ? 'primary' : 'secondary'}
              size="compact"
              icon="folder"
              onClick={() => changeFilter('collection', collection)}
            >
              {collection}
            </Button>
          ))}
        </div>
      ) : null}
      {result !== undefined && error === null ? (
        <Tabs
          label="Source types"
          value={type}
          onChange={setType}
          items={(['ALL', ...SOURCE_TYPES] as const).map((value) => ({
            value,
            label: value === 'ALL' ? 'All sources' : value,
            count: value === 'ALL' ? total : (facets?.types[value] ?? 0),
            content: value === type ? collection : null,
          }))}
        />
      ) : null}
      {result && result.totalElements > 0 ? (
        <nav className={styles.pagination} aria-label="Source pages">
          <Button
            variant="secondary"
            size="compact"
            disabled={page === 0 || isFetching}
            onClick={() => changeFilter('page', String(page - 1))}
          >
            Previous
          </Button>
          <span role="status">
            Page {page + 1} · {result.totalElements} matching sources
          </span>
          <Button
            variant="secondary"
            size="compact"
            disabled={!result.hasNext || isFetching}
            onClick={() => changeFilter('page', String(page + 1))}
          >
            Next
          </Button>
        </nav>
      ) : null}
      <Button
        className={styles.refresh}
        variant="ghost"
        size="compact"
        icon="refresh"
        disabled={isFetching}
        onClick={() => {
          void refetch();
          void refreshFacets();
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
