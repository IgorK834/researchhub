import { getIntlLocale } from '../../../shared/i18n';
import { t as uiText, useLocale as useUiLocale } from '../../../shared/i18n';
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
import { BibliographyImportDialog } from './BibliographyImportDialog';
import { BibliographyLibrary } from './BibliographyLibrary';
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
  useUiLocale();
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
  const [bibliographyOpen, setBibliographyOpen] = useState(false);
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
      get header() {
        return uiText('ui.CsvAssetProfile.message013');
      },
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
                {uiText('ui.SourceList.message001')}{' '}
                {source.failureSummary ?? uiText('ui.SourceList.message002')}
              </p>
            ) : null}
          </div>
        </div>
      ),
    },
    {
      id: 'type',
      get header() {
        return uiText('ui.DatasetPreviewPanel.message048');
      },
      render: (source) => <SourceTypeBadge sourceType={source.sourceType} />,
    },
    {
      id: 'uploader',
      get header() {
        return uiText('ui.SourceList.message003');
      },
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
      get header() {
        return uiText('ui.SourceList.message004');
      },
      priority: 'metadata',
      render: (source) => (
        <time dateTime={source.createdAt}>
          {new Intl.DateTimeFormat(getIntlLocale(), { dateStyle: 'medium' }).format(
            new Date(source.createdAt),
          )}
        </time>
      ),
    },
    {
      id: 'status',
      get header() {
        return uiText('ui.SourceList.message005');
      },
      render: (source) => <SourceStatusChip status={source.status} />,
    },
    {
      id: 'actions',
      get header() {
        return uiText('ui.DocumentList.message020');
      },
      render: (source) => (
        <div className={styles.actions}>
          {source.status === 'READY' ? (
            <Link
              to={`/app/workspaces/${workspaceId}/ask?askSource=${encodeURIComponent(source.id)}`}
            >
              <Icon name="sparkle" size={14} />
              {uiText('ui.SourceList.message006')}
            </Link>
          ) : null}
          <Link to={`/app/workspaces/${workspaceId}/sources/${source.id}`}>
            <Icon name="external" size={14} />
            {uiText('ui.ClaimEvidencePanel.message011')}
          </Link>
          <a
            href={sourceContentPath(workspaceId, source.id)}
            download={source.displayName}
          >
            <Icon name="download" size={14} />
            {uiText('ui.ExportDocument.message004')}
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
        context={
          type === 'ALL'
            ? uiText('ui.SourceList.message007')
            : uiText('ui.SourceList.message008', { value0: type })
        }
        title={
          total === 0 && !filtered
            ? uiText('ui.SourceList.message009')
            : type !== 'ALL'
              ? uiText('ui.SourceList.message010', { value0: type })
              : uiText('ui.SourceList.message011')
        }
        description={
          filtered && type === 'ALL'
            ? uiText('ui.SourceList.message012')
            : type === 'ALL'
              ? uiText('ui.SourceList.message013')
              : uiText('ui.SourceList.message014', { value0: type })
        }
        art={<Illustration scene={total === 0 ? 'sources' : 'search'} />}
        tone="blue"
        actions={
          canEdit && total === 0 && !filtered
            ? [
                <Button key="upload" icon="upload" onClick={() => setUploadOpen(true)}>
                  {uiText('ui.SourceList.message015')}
                </Button>,
              ]
            : filtered
              ? [
                  <Button key="clear" variant="secondary" onClick={clearFilters}>
                    {uiText('ui.SourceList.message016')}
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
          caption={uiText('ui.SourceList.message017')}
        />
      </div>
    );
  return (
    <section className={styles.library} aria-labelledby="workspace-sources-heading">
      <header className={styles.header}>
        <div>
          <h1 id="workspace-sources-heading">{uiText('ui.landingContent.message005')}</h1>
          {facets !== undefined && error === null && facetsError === null ? (
            <p>
              {total}{' '}
              {total === 1
                ? uiText('ui.DocumentSources.message004')
                : uiText('ui.AiDraftBlock.message004')}{' '}
              · {readyCount} {uiText('ui.SourceList.message018')}
            </p>
          ) : null}
        </div>
        <div className={styles.headerActions}>
          <Link to={`/app/workspaces/${workspaceId}/external-sources`}>
            {uiText('ui.ExternalSources.message001')}
          </Link>
          {readyCount !== undefined && error === null ? (
            <Sticker
              tone="blue"
              icon="sparkle"
              label={uiText('counts.readyGrounded', { count: readyCount })}
            />
          ) : null}
          {canEdit && total !== 0 ? (
            <Button icon="upload" onClick={() => setUploadOpen(true)}>
              {uiText('ui.SourceList.message015')}
            </Button>
          ) : null}
          {canEdit ? (
            <Button
              variant="secondary"
              icon="download"
              onClick={() => setBibliographyOpen(true)}
            >
              {uiText('ui.BibliographyImportDialog.message002')}
            </Button>
          ) : null}
        </div>
      </header>
      {archived ? <p role="status">{uiText('ui.SourceList.message020')}</p> : null}
      {isPending ? <p role="status">{uiText('ui.DocumentSources.message008')}</p> : null}
      {error !== null ? (
        <p role="alert">
          {uiText('ui.SourceList.message021')} {describeError(error)}
        </p>
      ) : null}
      {facetsError ? (
        <p role="alert">
          {uiText('ui.SourceList.message022')} {describeError(facetsError)}
        </p>
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
          label={uiText('ui.SourceList.message023')}
          type="search"
          placeholder={uiText('ui.SourceList.message024')}
          maxLength={200}
          key={filters.query}
          name="query"
          defaultValue={filters.query}
        />
        <Button variant="secondary" type="submit" icon="search">
          {uiText('ui.WorkspaceCommandSearch.message003')}
        </Button>
      </form>
      <ResponsiveFilters>
        <div className={styles.filters}>
          <Select
            label={uiText('ui.SourceList.message005')}
            value={filters.status}
            onChange={(event) => changeFilter('status', event.target.value)}
          >
            <option value="">{uiText('ui.SourceList.message025')}</option>
            {['UPLOADED', 'PROCESSING', 'READY', 'FAILED'].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
          <Select
            label={uiText('ui.SourceList.message003')}
            value={filters.uploader}
            onChange={(event) => changeFilter('uploader', event.target.value)}
          >
            <option value="">{uiText('ui.SourceList.message026')}</option>
            {(facets?.uploaders ?? []).map((id) => (
              <option key={id} value={id}>
                {uploaderNames.get(id) ?? id}
              </option>
            ))}
          </Select>
          <Select
            label={uiText('ui.SourceList.message027')}
            value={filters.tag}
            onChange={(event) => changeFilter('tag', event.target.value)}
          >
            <option value="">{uiText('ui.SourceList.message028')}</option>
            {(facets?.tags ?? []).map((tag) => (
              <option key={tag} value={tag}>
                {tag}
              </option>
            ))}
          </Select>
          {filtered ? (
            <Button variant="ghost" onClick={clearFilters}>
              {uiText('ui.SourceList.message029')}
            </Button>
          ) : null}
        </div>
      </ResponsiveFilters>
      {facets?.collections.length ? (
        <div
          className={styles.collections}
          aria-label={uiText('ui.SourceList.message030')}
        >
          <Button
            variant={filters.collection === '' ? 'primary' : 'secondary'}
            size="compact"
            onClick={() => changeFilter('collection', '')}
          >
            {uiText('ui.SourceList.message031')}
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
          label={uiText('ui.SourceList.message032')}
          value={type}
          onChange={setType}
          items={(['ALL', ...SOURCE_TYPES] as const).map((value) => ({
            value,
            label: value === 'ALL' ? uiText('ui.SourceList.message033') : value,
            count: value === 'ALL' ? total : (facets?.types[value] ?? 0),
            content: value === type ? collection : null,
          }))}
        />
      ) : null}
      {result && result.totalElements > 0 ? (
        <nav
          className={styles.pagination}
          aria-label={uiText('ui.SourceList.message034')}
        >
          <Button
            variant="secondary"
            size="compact"
            disabled={page === 0 || isFetching}
            onClick={() => changeFilter('page', String(page - 1))}
          >
            {uiText('ui.SourceList.message035')}
          </Button>
          <span role="status">
            {uiText('ui.ExternalSources.message039')} {page + 1} · {result.totalElements}{' '}
            {uiText('ui.SourceList.message036')}
          </span>
          <Button
            variant="secondary"
            size="compact"
            disabled={!result.hasNext || isFetching}
            onClick={() => changeFilter('page', String(page + 1))}
          >
            {uiText('ui.AnalysisWidgets.message004')}
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
        {uiText('ui.SourceList.message037')}
      </Button>
      <BibliographyLibrary workspaceId={workspaceId} canEdit={canEdit} />
      {canEdit ? (
        <>
          <SourceUploadForm
            workspaceId={workspaceId}
            open={uploadOpen}
            onClose={() => setUploadOpen(false)}
          />
          <BibliographyImportDialog
            workspaceId={workspaceId}
            open={bibliographyOpen}
            onClose={() => setBibliographyOpen(false)}
          />
        </>
      ) : null}
    </section>
  );
}
