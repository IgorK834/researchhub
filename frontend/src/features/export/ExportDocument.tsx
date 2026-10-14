import { t as uiText, useLocale as useUiLocale } from '../../shared/i18n';
import { useState, type ReactElement } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Button } from '../../shared/components/Button';
import { Dialog } from '../../shared/components/overlays';
import { describeError } from '../../shared/api';
import {
  createExport,
  citationStyleLabels,
  downloadExport,
  exportFailure,
  exportFormatLabels,
  fetchExport,
  type ExportFormat,
  type CitationStyle,
} from './exportApi';
import styles from './ExportDocument.module.css';
import type { Locale } from '../../shared/i18n';
import { Select } from '../../shared/components/forms';

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
  useUiLocale();
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<ExportFormat>('DOCX');
  const [citationStyle, setCitationStyle] = useState<CitationStyle>('APA_7');
  const [exportLanguage, setExportLanguage] = useState<Locale>('en');
  const create = useMutation({
    mutationFn: () =>
      createExport(
        workspaceId,
        documentId,
        format,
        citationStyle,
        revision,
        exportLanguage,
      ),
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
        {uiText('ui.ExportDocument.message001')}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={uiText('ui.ExportDocument.message002')}
        description={uiText('ui.ExportDocument.message003')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {uiText('ui.CanvasContextPreview.message006')}
            </Button>
            {job.data?.status === 'SUCCEEDED' ? (
              <Button
                icon="download"
                disabled={download.isPending}
                onClick={() => download.mutate()}
              >
                {uiText('ui.ExportDocument.message004')}{' '}
                {exportFormatLabels[job.data.format]}
              </Button>
            ) : null}
            <Button
              disabled={!settled || pending}
              onClick={() => {
                download.reset();
                create.mutate();
              }}
            >
              {pending
                ? uiText('ui.ExportDocument.message005')
                : uiText('ui.ExportDocument.message006')}
            </Button>
          </>
        }
      >
        <div className={styles.content}>
          <Select
            label={uiText('export.language')}
            value={exportLanguage}
            disabled={pending}
            onChange={(event) => setExportLanguage(event.target.value as Locale)}
          >
            <option value="en">English</option>
            <option value="pl">Polski</option>
          </Select>
          <p>{uiText('export.languageHint')}</p>
          <fieldset className={styles.formats} disabled={pending}>
            <legend>{uiText('ui.ExportDocument.message007')}</legend>
            <label>
              <input
                type="radio"
                name="export-format"
                value="DOCX"
                checked={format === 'DOCX'}
                onChange={() => setFormat('DOCX')}
              />
              <strong>{uiText('ui.ExportDocument.message008')}</strong>
              <span>{uiText('ui.ExportDocument.message009')}</span>
            </label>
            <label>
              <input
                type="radio"
                name="export-format"
                value="PDF"
                checked={format === 'PDF'}
                onChange={() => setFormat('PDF')}
              />
              <strong>{uiText('ui.ExportDocument.message010')}</strong>
              <span>{uiText('ui.ExportDocument.message011')}</span>
            </label>
            <label>
              <input
                type="radio"
                name="export-format"
                value="LATEX"
                checked={format === 'LATEX'}
                onChange={() => setFormat('LATEX')}
              />
              <strong>{uiText('ui.ExportDocument.message012')}</strong>
              <span>{uiText('ui.ExportDocument.message013')}</span>
            </label>
          </fieldset>
          <fieldset className={styles.formats} disabled={pending}>
            <legend>{uiText('ui.ExportDocument.message014')}</legend>
            {(Object.keys(citationStyleLabels) as CitationStyle[]).map((style) => (
              <label key={style}>
                <input
                  type="radio"
                  name="citation-style"
                  value={style}
                  checked={citationStyle === style}
                  onChange={() => setCitationStyle(style)}
                />
                <strong>{citationStyleLabels[style]}</strong>
                <span>
                  {style === 'APA_7'
                    ? uiText('ui.ExportDocument.message015')
                    : uiText('ui.ExportDocument.message016')}
                </span>
              </label>
            ))}
          </fieldset>
          {format === 'LATEX' ? <p>{uiText('ui.ExportDocument.message017')}</p> : null}
          <p>{uiText('ui.ExportDocument.message018')}</p>
          <p>
            {settled
              ? uiText('ui.ExportDocument.message019', { value0: revision })
              : uiText('ui.ExportDocument.message020')}
          </p>
          <p>{uiText('ui.ExportDocument.message021')}</p>
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
                  {uiText('ui.ExportDocument.message022')}
                </Button>
              ) : null}
            </div>
          ) : null}
          {job.data?.status === 'QUEUED' || job.data?.status === 'RUNNING' ? (
            <p role="status">
              {uiText('ui.AnalysisStatus.message002')}{' '}
              {exportFormatLabels[job.data.format]}{' '}
              {uiText('ui.ExportDocument.message023')} {job.data.revision}…
            </p>
          ) : null}
          {job.data?.status === 'SUCCEEDED' ? (
            <p role="status">
              {uiText('ui.ExportDocument.message024')}{' '}
              {exportFormatLabels[job.data.format]}{' '}
              {uiText('ui.ExportDocument.message025')} {job.data.revision}{' '}
              {uiText('ui.ExportDocument.message026')}
            </p>
          ) : null}
          {job.data?.status === 'FAILED' ? (
            <p role="alert">{exportFailure(job.data.failureCode)}</p>
          ) : null}
          {job.data?.status === 'EXPIRED' ? (
            <p role="status">{uiText('ui.ExportDocument.message027')}</p>
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
