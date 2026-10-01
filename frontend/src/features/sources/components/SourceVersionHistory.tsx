import type { ReactElement } from 'react';

import { describeError } from '../../../shared/api';
import { sourceVersionContentPath, type SourceVersion } from '../api/sourceApi';
import { SOURCE_STATUS_LABELS } from '../api/sourceTypes';
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
  return (
    <section aria-labelledby="source-versions-heading">
      <h2 id="source-versions-heading">Versions</h2>
      <p>
        Each upload is kept as an immutable version. Existing analyses keep the version
        they used.
      </p>
      <table aria-label="Source versions">
        <thead>
          <tr>
            <th scope="col">Version</th>
            <th scope="col">File</th>
            <th scope="col">Size</th>
            <th scope="col">Status</th>
            <th scope="col">Uploaded</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {versions.data.map((version) => (
            <VersionRow
              key={version.id}
              workspaceId={workspaceId}
              sourceId={sourceId}
              version={version}
              selected={version.id === selectedVersionId}
              {...(onPreview === undefined ? {} : { onPreview })}
            />
          ))}
        </tbody>
      </table>
    </section>
  );
}

function VersionRow({
  workspaceId,
  sourceId,
  version,
  selected,
  onPreview,
}: {
  readonly workspaceId: string;
  readonly sourceId: string;
  readonly version: SourceVersion;
  readonly selected: boolean;
  readonly onPreview?: (versionId: string) => void;
}): ReactElement {
  const canPreview =
    onPreview !== undefined &&
    TABULAR.has(version.sourceType) &&
    version.status === 'READY';
  return (
    <tr aria-current={selected ? 'true' : undefined}>
      <th scope="row">
        {version.versionNumber}
        {version.active ? ' (latest)' : ''}
      </th>
      <td>{version.originalFilename}</td>
      <td>{version.sizeBytes.toLocaleString()} bytes</td>
      <td>{SOURCE_STATUS_LABELS[version.status]}</td>
      <td>
        <time dateTime={version.createdAt}>
          {new Intl.DateTimeFormat(undefined, {
            dateStyle: 'medium',
            timeStyle: 'short',
          }).format(new Date(version.createdAt))}
        </time>
      </td>
      <td>
        <a
          href={sourceVersionContentPath(workspaceId, sourceId, version.id)}
          download={version.originalFilename}
          aria-label={`Download version ${String(version.versionNumber)}`}
        >
          Download
        </a>
        {canPreview ? (
          <>
            {' '}
            <button
              type="button"
              aria-pressed={selected}
              aria-label={`Preview data of version ${String(version.versionNumber)}`}
              onClick={() => onPreview(version.id)}
            >
              Preview data
            </button>
          </>
        ) : null}
      </td>
    </tr>
  );
}
