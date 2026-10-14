import { getIntlLocale } from '../shared/i18n';
import { t as uiText, useLocale as useUiLocale } from '../shared/i18n';
import type { ReactElement } from 'react';
import { CitationVersionStatus } from '../features/ai/components/CitationVersionStatus';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { PdfSourcePreview } from '../features/sources/components/PdfSourcePreview';
import { SourceProcessing } from '../features/sources/components/SourceProcessing';
import { parsePdfPage } from '../features/sources/api/sourceLocations';
import { queryKeys } from '../shared/api';
import { useQueryClient } from '@tanstack/react-query';
import { SourceExtractionPreview } from '../features/sources/components/SourceExtractionPreview';
import { sourceContentPath } from '../features/sources/api/sourceApi';
import {
  SourceTypeTile,
  SourceTypeBadge,
  SourceStatusChip,
} from '../features/sources/components/SourceVisuals';
import {
  useSourceQuery,
  useSourceVersionsQuery,
} from '../features/sources/api/useSources';
import {
  useWorkspaceMembersQuery,
  useWorkspaceQuery,
} from '../features/workspaces/api/useWorkspaces';
import { describeError, hasApiErrorCode } from '../shared/api';
import { DatasetPreviewPanel } from '../features/analysis/components/DatasetPreviewPanel';
import { SourceReplaceForm } from '../features/sources/components/SourceReplaceForm';
import { SourceVersionHistory } from '../features/sources/components/SourceVersionHistory';
import type { AnalyzeTarget } from '../features/analysis/components/DatasetPreviewPanel';
import { workspaceCapabilities } from '../shared/utils/workspaceCapabilities';

import { SourceMetadataPanel } from '../features/sources/components/SourceMetadataPanel';
import { SourceDetailFrame } from '../features/sources/components/SourceDetailFrame';
import { Button } from '../shared/components/Button';
import { Panel } from '../shared/components/content';
import { Banner } from '../shared/components/feedback';
import styles from '../features/sources/components/SourceDetail.module.css';

export function SourceDetailPage({
  embedded = false,
}: {
  readonly embedded?: boolean;
}): ReactElement {
  const { workspaceId, sourceId } = useParams<{
    workspaceId: string;
    sourceId: string;
  }>();
  if (workspaceId === undefined || sourceId === undefined) {
    return <SourceNotFound workspaceId={workspaceId} />;
  }
  return (
    <SourceDetail workspaceId={workspaceId} sourceId={sourceId} embedded={embedded} />
  );
}

function SourceNotFound({
  workspaceId,
}: {
  readonly workspaceId?: string;
}): ReactElement {
  useUiLocale();
  return (
    <section>
      <h1>{uiText('ui.SourceDetailPage.message001')}</h1>
      <p>{uiText('ui.SourceDetailPage.message002')}</p>
      <Link
        to={
          workspaceId === undefined ? '/app/workspaces' : `/app/workspaces/${workspaceId}`
        }
      >
        {uiText('ui.DocumentDetailPage.message003')}
      </Link>
    </section>
  );
}

function SourceDetail({
  workspaceId,
  sourceId,
  embedded,
}: {
  readonly workspaceId: string;
  readonly sourceId: string;
  readonly embedded: boolean;
}): ReactElement {
  useUiLocale();
  const {
    data: source,
    error,
    isPending,
    refetch,
  } = useSourceQuery(workspaceId, sourceId);
  const { data: members } = useWorkspaceMembersQuery(workspaceId);
  const workspace = useWorkspaceQuery(
    workspaceId,
    source !== undefined && error === null,
  );
  const { data: versions } = useSourceVersionsQuery(workspaceId, sourceId);
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const client = useQueryClient();
  const { canEditContent } = workspaceCapabilities(
    workspace.error === null ? workspace.data?.role : undefined,
    workspace.data === undefined || workspace.data.archivedAt !== null,
  );
  const analyze = (target: AnalyzeTarget): void => {
    const params = new URLSearchParams({
      analyzeSource: target.sourceId,
      analyzeVersion: target.sourceVersionId,
      analyzeSheet: target.sheetName,
    });
    void navigate(`/app/workspaces/${workspaceId}?${params.toString()}`);
  };
  const previewVersion = (versionId: string): void => {
    const next = new URLSearchParams(search);
    next.set('version', versionId);
    setSearch(next);
  };
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
    return <p role="status">{uiText('ui.SourceDetailPage.message003')}</p>;
  }
  if (error !== null) {
    return (
      <p role="alert">
        {uiText('ui.SourceDetailPage.message004')} {describeError(error)}
      </p>
    );
  }

  const uploader =
    members?.find((member) => member.userId === source.uploadedBy)?.displayName ??
    source.uploadedBy;
  // The data preview follows ?version=<id> when it names a known version, and otherwise the latest one.
  const requestedVersion = versions?.find(
    (version) => version.id === search.get('version'),
  );
  const previewedVersion =
    requestedVersion ??
    versions?.find((version) => version.id === source.activeVersionId);
  const previewVersionId = previewedVersion?.id ?? source.activeVersionId;
  const previewType = previewedVersion?.sourceType ?? source.sourceType;
  const previewStatus = previewedVersion?.status ?? source.status;
  const hasDatasetPreview =
    (previewType === 'CSV' || previewType === 'XLSX') &&
    previewStatus === 'READY' &&
    Boolean(previewVersionId);
  const askSourcePath = `/app/workspaces/${encodeURIComponent(workspaceId)}/ask?askSource=${encodeURIComponent(sourceId)}`;

  const metadata = (
    <div
      className={`${styles.metadata} ${hasDatasetPreview ? styles.datasetMetadata : ''}`}
    >
      <Panel title={uiText('ui.SourceDetailPage.message005')}>
        <dl>
          <dt>{uiText('ui.DatasetPreviewPanel.message048')}</dt>
          <dd>
            <SourceTypeBadge sourceType={source.sourceType} />
          </dd>
          <dt>{uiText('ui.AnalysisStudio.message004')}</dt>
          <dd>
            {source.activeVersionNumber} {uiText('ui.DatasetPreviewPanel.message011')}
          </dd>
          <dt>{uiText('ui.SourceList.message005')}</dt>
          <dd>
            <SourceStatusChip status={source.status} />
          </dd>
          <dt>{uiText('ui.SourceList.message003')}</dt>
          <dd>{uploader}</dd>
          <dt>{uiText('ui.SourceDetailPage.message006')}</dt>
          <dd>
            <time dateTime={source.createdAt}>
              {new Intl.DateTimeFormat(getIntlLocale(), {
                dateStyle: 'medium',
                timeStyle: 'short',
              }).format(new Date(source.createdAt))}
            </time>
          </dd>
          <dt>{uiText('ui.DatasetPreviewPanel.message013')}</dt>
          <dd>
            {source.sizeBytes.toLocaleString(getIntlLocale())}{' '}
            {uiText('ui.AnalysisProvenance.message027')}
          </dd>
        </dl>
      </Panel>
      <SourceMetadataPanel source={source} canEdit={canEditContent} />
      <Button href={askSourcePath} icon="sparkle" disabled={source.status !== 'READY'}>
        {uiText('ui.SourceDetailPage.message007')}
      </Button>
      <Button
        href={sourceContentPath(workspaceId, sourceId)}
        download={source.displayName}
        variant="secondary"
        icon="download"
      >
        {uiText('ui.SourceDetailPage.message008')}
      </Button>
    </div>
  );
  const processing = (
    <SourceProcessing
      workspaceId={workspaceId}
      sourceId={sourceId}
      status={source.status}
      canEdit={canEditContent}
    />
  );
  return (
    <SourceDetailFrame
      embedded={embedded}
      metadata={hasDatasetPreview ? undefined : metadata}
      header={
        <>
          <Link to={`/app/workspaces/${workspaceId}`}>
            {uiText('ui.DocumentDetailPage.message003')}
          </Link>
          {hasDatasetPreview ? null : (
            <header className={styles.header}>
              <SourceTypeTile sourceType={source.sourceType} />
              <div className={styles.heading}>
                <h1>{source.displayName}</h1>
                <div className={styles.badges}>
                  <SourceTypeBadge sourceType={source.sourceType} />
                  <SourceStatusChip status={source.status} />
                </div>
              </div>
            </header>
          )}
        </>
      }
    >
      {search.get('processingVersion') ? (
        <CitationVersionStatus
          key={source.updatedAt}
          workspaceId={workspaceId}
          sourceId={sourceId}
          processingVersion={search.get('processingVersion') ?? ''}
        />
      ) : null}
      {source.failureSummary === null ? null : (
        <Banner
          tone="error"
          lead={uiText('ui.SourceDetailPage.message010', {
            value0: source.failureSummary,
          })}
        />
      )}
      {hasDatasetPreview ? null : processing}
      {hasDatasetPreview && previewVersionId ? (
        <DatasetPreviewPanel
          workspaceId={workspaceId}
          sourceId={sourceId}
          sourceVersionId={previewVersionId}
          sourceName={source.displayName}
          sourceInfo={metadata}
          isLatestVersion={previewVersionId === source.activeVersionId}
          onAnalyze={analyze}
          onAsk={() => {
            void navigate(askSourcePath);
          }}
        />
      ) : null}
      {hasDatasetPreview ? processing : null}
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
      <SourceVersionHistory
        workspaceId={workspaceId}
        sourceId={sourceId}
        selectedVersionId={previewVersionId}
        onPreview={previewVersion}
      />
      {canEditContent && (source.status === 'READY' || source.status === 'FAILED') ? (
        <SourceReplaceForm workspaceId={workspaceId} sourceId={sourceId} />
      ) : null}
      <Button
        variant="ghost"
        icon="refresh"
        type="button"
        onClick={() => {
          void refetch();
          void client.invalidateQueries({
            queryKey: queryKeys.sourceExtraction(workspaceId, sourceId),
          });
        }}
      >
        {uiText('ui.SourceDetailPage.message009')}
      </Button>
    </SourceDetailFrame>
  );
}
