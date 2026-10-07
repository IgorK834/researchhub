import { useState, type ReactElement } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Button } from '../../shared/components/Button';
import { Dialog } from '../../shared/components/overlays';
import { describeError } from '../../shared/api';
import {
  createExport,
  downloadExport,
  exportFailure,
  exportFormatLabels,
  fetchExport,
  type ExportFormat,
} from './exportApi';
import styles from './ExportDocument.module.css';

/** Exports only saved revisions. Closing the dialog leaves the durable server job running. */
export function ExportDocument({
  workspaceId,
  documentId,
  revision,
  settled,
}: {
  readonly workspaceId: string;
  readonly documentId: string;
  readonly revision: number;
  readonly settled: boolean;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<ExportFormat>('DOCX');
  const create = useMutation({
    mutationFn: () => createExport(workspaceId, documentId, format, revision),
  });
  const jobId = create.data?.id;
  const job = useQuery({
    queryKey: ['report-export', workspaceId, documentId, jobId],
    queryFn: ({ signal }) => fetchExport(workspaceId, documentId, jobId!, signal),
    enabled: open && jobId !== undefined,
    initialData: create.data,
    retry: false,
    refetchInterval: (query) =>
      query.state.error === null &&
      ['QUEUED', 'RUNNING'].includes(query.state.data?.status ?? '')
        ? 1000
        : false,
  });
  const download = useMutation({ mutationFn: () => downloadExport(job.data!) });
  const pending =
    create.isPending || job.data?.status === 'QUEUED' || job.data?.status === 'RUNNING';
  const error = create.error ?? job.error ?? download.error;
  return (
    <>
      <Button variant="secondary" icon="download" onClick={() => setOpen(true)}>
        Export
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Export document"
        description="Take a saved report into your university or research workflow."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Close
            </Button>
            {job.data?.status === 'SUCCEEDED' ? (
              <Button
                icon="download"
                disabled={download.isPending}
                onClick={() => download.mutate()}
              >
                Download {exportFormatLabels[job.data.format]}
              </Button>
            ) : null}
            <Button
              disabled={!settled || pending}
              onClick={() => {
                download.reset();
                create.mutate();
              }}
            >
              {pending ? 'Preparing report…' : 'Generate export'}
            </Button>
          </>
        }
      >
        <div className={styles.content}>
          <fieldset className={styles.formats} disabled={pending}>
            <legend>File format</legend>
            <label>
              <input
                type="radio"
                name="export-format"
                value="DOCX"
                checked={format === 'DOCX'}
                onChange={() => setFormat('DOCX')}
              />
              <strong>Word document (.docx)</strong>
              <span>Edit and submit in office software.</span>
            </label>
            <label>
              <input
                type="radio"
                name="export-format"
                value="PDF"
                checked={format === 'PDF'}
                onChange={() => setFormat('PDF')}
              />
              <strong>PDF report (.pdf)</strong>
              <span>A final report with paginated pages.</span>
            </label>
            <label>
              <input
                type="radio"
                name="export-format"
                value="LATEX"
                checked={format === 'LATEX'}
                onChange={() => setFormat('LATEX')}
              />
              <strong>LaTeX sources (.zip)</strong>
              <span>Edit report.tex and compile locally with included chart images.</span>
            </label>
          </fieldset>
          {format === 'LATEX' ? (
            <p>Extract the ZIP, then use XeLaTeX or LuaLaTeX to typeset your report.</p>
          ) : null}
          <p>
            Includes headings, lists, tables, charts, captions, and numbered citations
            with references.
          </p>
          <p>
            {settled
              ? `Saved revision ${revision} is ready to export.`
              : 'Wait for your changes to be saved before generating an export.'}
          </p>
          <p>
            You can close this dialog while the report is prepared. Reopen it to download.
            Downloads are available for seven days by default.
          </p>
          {error !== null ? (
            <div role="alert">
              {describeError(error)}
              {job.error !== null ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    void job.refetch();
                  }}
                >
                  Check export status
                </Button>
              ) : null}
            </div>
          ) : null}
          {job.data?.status === 'QUEUED' || job.data?.status === 'RUNNING' ? (
            <p role="status">
              Preparing {exportFormatLabels[job.data.format]} from revision{' '}
              {job.data.revision}…
            </p>
          ) : null}
          {job.data?.status === 'SUCCEEDED' ? (
            <p role="status">
              Your {exportFormatLabels[job.data.format]} report from revision{' '}
              {job.data.revision} is ready.
            </p>
          ) : null}
          {job.data?.status === 'FAILED' ? (
            <p role="alert">{exportFailure(job.data.failureCode)}</p>
          ) : null}
          {job.data?.status === 'EXPIRED' ? (
            <p role="status">This export has expired. Generate it again to download.</p>
          ) : null}
          {job.data?.warnings.map((warning) => (
            <p key={warning} role="status">
              {warning}
            </p>
          ))}
        </div>
      </Dialog>
    </>
  );
}
