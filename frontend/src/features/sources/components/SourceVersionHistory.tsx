import { getIntlLocale } from '../../../shared/i18n';
import { t as uiText, useLocale as useUiLocale } from '../../../shared/i18n';
import { DataTable, Panel, type TableColumn } from '../../../shared/components/content';
import { Button } from '../../../shared/components/Button';
import type { ReactElement } from 'react';

import { describeError } from '../../../shared/api';
import { sourceVersionContentPath, type SourceVersion } from '../api/sourceApi';
import { SourceStatusChip } from './SourceVisuals';
import { useSourceVersionsQuery } from '../api/useSources';

const TABULAR = new Set(['CSV', 'XLSX']);

/**
 * Every upload of a source is kept as an immutable version. Older versions stay downloadable, and a data version can
 * be previewed, so an analysis that used it can always be inspected against the exact bytes it saw.
 */
export function SourceVersionHistory({
  workspaceId,
  sourceId,
  selectedVersionId,
  onPreview,
}: {
  readonly workspaceId: string;
  readonly sourceId: string;
  /** The version whose data preview is on screen, if any. */
  readonly selectedVersionId?: string | undefined;
  readonly onPreview?: (versionId: string) => void;
}): ReactElement {
  useUiLocale();
  const versions = useSourceVersionsQuery(workspaceId, sourceId);
  if (versions.isPending)
    return <p role="status">{uiText('ui.DocumentHistory.message012')}</p>;
  if (versions.error !== null) {
    return (
      <p role="alert">
        {uiText('ui.SourceVersionHistory.message001')} {describeError(versions.error)}
      </p>
    );
  }
  const columns: readonly TableColumn<SourceVersion>[] = [
    {
      id: 'version',
      get header() {
        return uiText('ui.AnalysisStudio.message004');
      },
      rowHeader: true,
      render: (version) =>
        `${String(version.versionNumber)}${version.active ? ' (latest)' : ''}`,
    },
    {
      id: 'file',
      get header() {
        return uiText('ui.DatasetPreviewPanel.message010');
      },
      render: (version) => version.originalFilename,
    },
    {
      id: 'size',
      get header() {
        return uiText('ui.DatasetPreviewPanel.message013');
      },
      render: (version) => `${version.sizeBytes.toLocaleString(getIntlLocale())} bytes`,
    },
    {
      id: 'status',
      get header() {
        return uiText('ui.SourceList.message005');
      },
      render: (version) => <SourceStatusChip status={version.status} />,
    },
    {
      id: 'uploaded',
      get header() {
        return uiText('ui.SourceUploadForm.message015');
      },
      render: (version) => (
        <time dateTime={version.createdAt}>
          {new Intl.DateTimeFormat(getIntlLocale(), {
            dateStyle: 'medium',
            timeStyle: 'short',
          }).format(new Date(version.createdAt))}
        </time>
      ),
    },
    {
      id: 'actions',
      get header() {
        return uiText('ui.DocumentList.message020');
      },
      render: (version) => (
        <>
          <Button
            size="compact"
            variant="ghost"
            icon="download"
            href={sourceVersionContentPath(workspaceId, sourceId, version.id)}
            download={version.originalFilename}
            aria-label={uiText('ui.SourceVersionHistory.message002', {
              value0: String(version.versionNumber),
            })}
          >
            {uiText('ui.ExportDocument.message004')}
          </Button>
          {onPreview !== undefined &&
          TABULAR.has(version.sourceType) &&
          version.status === 'READY' ? (
            <Button
              size="compact"
              variant="secondary"
              aria-pressed={version.id === selectedVersionId}
              aria-label={uiText('ui.SourceVersionHistory.message003', {
                value0: String(version.versionNumber),
              })}
              onClick={() => onPreview(version.id)}
            >
              {uiText('ui.SourceVersionHistory.message004')}
            </Button>
          ) : null}
        </>
      ),
    },
  ];
  return (
    <Panel title={uiText('ui.DocumentHistory.message016')}>
      <p>{uiText('ui.SourceVersionHistory.message005')}</p>
      <DataTable
        columns={columns}
        rows={versions.data}
        rowKey={(version) => version.id}
        isSelected={(version) => version.id === selectedVersionId}
        caption={uiText('ui.AnalysisProvenance.message005')}
      />
    </Panel>
  );
}
