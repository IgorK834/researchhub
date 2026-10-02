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
  const versions = useSourceVersionsQuery(workspaceId, sourceId);
  if (versions.isPending) return <p role="status">Loading versions…</p>;
  if (versions.error !== null) {
    return <p role="alert">Could not load versions: {describeError(versions.error)}</p>;
  }
  const columns: readonly TableColumn<SourceVersion>[] = [
    {
      id: 'version',
      header: 'Version',
      rowHeader: true,
      render: (version) =>
        `${String(version.versionNumber)}${version.active ? ' (latest)' : ''}`,
    },
    { id: 'file', header: 'File', render: (version) => version.originalFilename },
    {
      id: 'size',
      header: 'Size',
      render: (version) => `${version.sizeBytes.toLocaleString()} bytes`,
    },
    {
      id: 'status',
      header: 'Status',
      render: (version) => <SourceStatusChip status={version.status} />,
    },
    {
      id: 'uploaded',
      header: 'Uploaded',
      render: (version) => (
        <time dateTime={version.createdAt}>
          {new Intl.DateTimeFormat(undefined, {
            dateStyle: 'medium',
            timeStyle: 'short',
          }).format(new Date(version.createdAt))}
        </time>
      ),
    },
    {
      id: 'actions',
      header: 'Actions',
      render: (version) => (
        <>
          <Button
            size="compact"
            variant="ghost"
            icon="download"
            href={sourceVersionContentPath(workspaceId, sourceId, version.id)}
            download={version.originalFilename}
            aria-label={`Download version ${String(version.versionNumber)}`}
          >
            Download
          </Button>
          {onPreview !== undefined &&
          TABULAR.has(version.sourceType) &&
          version.status === 'READY' ? (
            <Button
              size="compact"
              variant="secondary"
              aria-pressed={version.id === selectedVersionId}
              aria-label={`Preview data of version ${String(version.versionNumber)}`}
              onClick={() => onPreview(version.id)}
            >
              Preview data
            </Button>
          ) : null}
        </>
      ),
    },
  ];
  return (
    <Panel title="Versions">
      <p>
        Each upload is kept as an immutable version. Existing analyses keep the version
        they used.
      </p>
      <DataTable
        columns={columns}
        rows={versions.data}
        rowKey={(version) => version.id}
        isSelected={(version) => version.id === selectedVersionId}
        caption="Source versions"
      />
    </Panel>
  );
}
