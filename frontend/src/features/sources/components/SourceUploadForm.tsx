import { useRef, useState, type ReactElement } from 'react';
import { useLocation } from 'react-router-dom';
import { describeError } from '../../../shared/api';
import { Button } from '../../../shared/components/Button';
import { Badge } from '../../../shared/components/identity';
import { Dialog } from '../../../shared/components/overlays';
import {
  checkSourceFile,
  SOURCE_FILE_ACCEPT,
  SOURCE_TYPES,
  SOURCE_TYPE_RULES,
} from '../api/sourceTypes';
import { useSourceQuery, useUploadSource } from '../api/useSources';
import { SourceStatusChip, SourceTypeBadge, SourceTypeTile } from './SourceVisuals';
import { SourceProgress } from './SourceProgress';
import { SourceRetry } from './SourceRetry';
import { formatSourceBytes } from './sourcePresentation';
import styles from './Sources.module.css';

interface QueueEntry {
  readonly id: number;
  readonly file: File;
  readonly sourceType: string;
  readonly phase: 'uploading' | 'rejected' | 'failed' | 'uploaded';
  readonly progress: number | null;
  readonly error: string | null;
  readonly sourceId: string | null;
}

function UploadedFile({
  workspaceId,
  sourceId,
}: {
  readonly workspaceId: string;
  readonly sourceId: string;
}): ReactElement {
  const source = useSourceQuery(workspaceId, sourceId);
  const status = source.data?.status ?? 'UPLOADED';
  return (
    <>
      <div className={styles.queueState}>
        <SourceStatusChip status={status} />
        {status === 'FAILED' ? (
          <SourceRetry workspaceId={workspaceId} sourceId={sourceId} />
        ) : null}
      </div>
      <div className={styles.queueBody}>
        {status === 'UPLOADED' || status === 'PROCESSING' ? (
          <SourceProgress workspaceId={workspaceId} sourceId={sourceId} />
        ) : null}
        {status === 'FAILED' ? (
          <p
            role="alert"
            className={styles.failure}
            title={source.data?.failureSummary ?? undefined}
          >
            {source.data?.failureSummary ?? 'Source processing failed.'}
          </p>
        ) : null}
        {source.error ? (
          <p role="alert">Could not load source status: {describeError(source.error)}</p>
        ) : null}
      </div>
    </>
  );
}

export interface SourceUploadFormProps {
  readonly workspaceId: string;
  readonly open: boolean;
  readonly onClose: () => void;
}

/** Keep this component mounted when closing the dialog: file uploads and its queue outlive the modal UI. */
export function SourceUploadForm({
  workspaceId,
  open,
  onClose,
}: SourceUploadFormProps): ReactElement {
  const input = useRef<HTMLInputElement>(null);
  const nextId = useRef(0);
  const [queue, setQueue] = useState<readonly QueueEntry[]>([]);
  const [dragging, setDragging] = useState(false);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const location = useLocation();
  const upload = useUploadSource(workspaceId);
  const update = (id: number, patch: Partial<QueueEntry>): void => {
    setQueue((current) =>
      current.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
    );
  };
  const send = async (entry: QueueEntry): Promise<void> => {
    update(entry.id, { phase: 'uploading', error: null, progress: null });
    try {
      const source = await upload.mutateAsync({
        file: entry.file,
        onProgress: (loaded, total) => {
          if (total > 0)
            update(entry.id, {
              progress: Math.min(100, Math.round((loaded / total) * 100)),
            });
        },
      });
      update(entry.id, { phase: 'uploaded', sourceId: source.id, progress: 100 });
    } catch (error) {
      update(entry.id, { phase: 'failed', error: describeError(error) });
    }
  };
  const addFiles = (files: readonly File[]): void => {
    const entries = files.map((file): QueueEntry => {
      const check = checkSourceFile(file);
      return {
        id: nextId.current++,
        file,
        sourceType: check.ok
          ? check.sourceType
          : (SOURCE_TYPES.find((type) =>
              file.name.toLowerCase().endsWith(`.${SOURCE_TYPE_RULES[type].extension}`),
            ) ?? 'Source'),
        phase: check.ok ? 'uploading' : 'rejected',
        progress: null,
        error: check.ok ? null : check.message,
        sourceId: null,
      };
    });
    setQueue((current) => [...current, ...entries]);
    for (const entry of entries) if (entry.phase === 'uploading') void send(entry);
  };
  const close = (): void => {
    setDismissedKey(location.key);
    setDragging(false);
    onClose();
  };
  return (
    <Dialog
      open={
        open ||
        (location.hash === '#upload-source-heading' && dismissedKey !== location.key)
      }
      onClose={close}
      title="Upload sources"
      description="Add research material to this workspace."
      className={styles.uploadDialog}
      footer={
        <div className={styles.dialogFooter}>
          <p>You can close this window. Uploads and processing continue.</p>
          <Button onClick={close}>Done</Button>
        </div>
      }
    >
      <div
        className={[styles.dropzone, dragging ? styles.dragging : ''].join(' ')}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          addFiles(Array.from(event.dataTransfer.files));
        }}
      >
        <div className={styles.uploadArt} aria-hidden="true">
          <SourceTypeTile sourceType="PDF" />
          <SourceTypeTile sourceType="CSV" />
          <SourceTypeTile sourceType="DOCX" />
        </div>
        <div>
          <h3>Drop files here</h3>
          <Button
            variant="secondary"
            icon="upload"
            onClick={() => input.current?.click()}
          >
            Browse files
          </Button>
          <label className="visually-hidden" htmlFor="source-file">
            Source file
          </label>
          <input
            ref={input}
            className="visually-hidden"
            tabIndex={-1}
            id="source-file"
            name="source-file"
            type="file"
            multiple
            accept={SOURCE_FILE_ACCEPT}
            onChange={(event) => {
              addFiles(Array.from(event.target.files ?? []));
              event.target.value = '';
            }}
          />
          <p>
            Up to 50 MB per file. Archives and macro-enabled Office files are not
            supported.
          </p>
          <p>Supported types:</p>
          <div className={styles.types}>
            {SOURCE_TYPES.map((type) => (
              <SourceTypeBadge key={type} sourceType={type} />
            ))}
          </div>
        </div>
      </div>
      {queue.length > 0 ? (
        <>
          <h3>
            {queue.length} {queue.length === 1 ? 'file' : 'files'}
          </h3>
          <ul className={styles.queue} aria-label="Upload queue">
            {queue.map((entry) => (
              <li key={entry.id} className={styles.queueRow}>
                <SourceTypeTile sourceType={entry.sourceType} />
                <div className={styles.queueBody}>
                  <div className={styles.queueName}>
                    <strong>{entry.file.name}</strong>
                    <span>{formatSourceBytes(entry.file.size)}</span>
                  </div>
                  {entry.phase === 'uploading' ? (
                    <div aria-live="polite">
                      <p>
                        Uploading {entry.file.name}
                        {entry.progress === null ? '…' : `: ${entry.progress}%`}
                      </p>
                      <progress
                        aria-label="Upload progress"
                        max={100}
                        value={entry.progress ?? undefined}
                      />
                    </div>
                  ) : null}
                  {entry.error ? (
                    <p role="alert" className={styles.failure} title={entry.error}>
                      {entry.error}
                    </p>
                  ) : null}
                  {entry.sourceId !== null ? (
                    <>
                      <p className="visually-hidden" role="status">
                        Uploaded {entry.file.name}.
                      </p>
                      <UploadedFile workspaceId={workspaceId} sourceId={entry.sourceId} />
                    </>
                  ) : null}
                </div>
                {entry.phase !== 'uploaded' ? (
                  <div className={styles.queueState}>
                    {entry.phase === 'uploading' ? (
                      <Badge label="Uploading" icon="upload" tone="blue" size="compact" />
                    ) : (
                      <SourceStatusChip status="FAILED" />
                    )}
                    {entry.phase === 'failed' ? (
                      <Button
                        size="compact"
                        variant="secondary"
                        icon="refresh"
                        onClick={() => {
                          void send(entry);
                        }}
                      >
                        Retry
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </Dialog>
  );
}
