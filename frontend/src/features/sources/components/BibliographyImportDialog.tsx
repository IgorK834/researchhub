import { t as uiText, useLocale as useUiLocale } from '../../../shared/i18n';
import { useRef, useState, type ReactElement } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { describeError, queryKeys } from '../../../shared/api';
import { Button } from '../../../shared/components/Button';
import { Select, TextField } from '../../../shared/components/forms';
import { Badge } from '../../../shared/components/identity';
import { Dialog } from '../../../shared/components/overlays';
import {
  cancelBibliographyImport,
  confirmBibliographyImport,
  previewBibliographyImport,
  fetchBibliographyImportResult,
  type BibliographyDecision,
  type BibliographyImportResult,
  type BibliographyOrigin,
  type BibliographyPreview,
  type BibliographyPreviewRecord,
} from '../api/bibliographyImportApi';
import styles from './BibliographyImportDialog.module.css';
import { useSourcesQuery } from '../api/useSources';

const MAX_BYTES = 2 * 1024 * 1024;

function title(record: BibliographyPreviewRecord): string {
  return (
    record.bibliography?.title ??
    record.bibliography?.citationKey ??
    uiText('ui.BibliographyImportDialog.message001')
  );
}

function statusTone(
  status: BibliographyPreviewRecord['status'],
): 'blue' | 'yellow' | 'coral' | 'mint' {
  if (status === 'READY') return 'mint';
  if (status === 'DUPLICATE') return 'blue';
  if (status === 'CONFLICT') return 'yellow';
  return 'coral';
}

export function BibliographyImportDialog({
  workspaceId,
  open,
  onClose,
}: {
  readonly workspaceId: string;
  readonly open: boolean;
  readonly onClose: () => void;
}): ReactElement {
  useUiLocale();
  const input = useRef<HTMLInputElement>(null);
  const cache = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [origin, setOrigin] = useState<BibliographyOrigin>('GENERIC');
  const [preview, setPreview] = useState<BibliographyPreview | null>(null);
  const [result, setResult] = useState<BibliographyImportResult | null>(null);
  const [decisions, setDecisions] = useState<ReadonlyMap<number, BibliographyDecision>>(
    new Map(),
  );
  const [localError, setLocalError] = useState<string | null>(null);
  const sources = useSourcesQuery(
    workspaceId,
    open && preview !== null && result === null,
  );
  const previewMutation = useMutation({
    mutationFn: () => {
      if (file === null) throw new Error(uiText('bibliography.chooseFile'));
      return previewBibliographyImport(workspaceId, file, origin);
    },
    onSuccess: async (value) => {
      setPreview(value);
      setLocalError(null);
      setDecisions(new Map());
      if (value.status === 'CONFIRMED')
        setResult(await fetchBibliographyImportResult(workspaceId, value.id));
    },
  });
  const confirmMutation = useMutation({
    mutationFn: () =>
      confirmBibliographyImport(workspaceId, preview?.id ?? '', [...decisions.values()]),
    onSuccess: (value) => {
      setResult(value);
      void cache.invalidateQueries({ queryKey: queryKeys.sources(workspaceId) });
      void cache.invalidateQueries({ queryKey: ['bibliography', workspaceId] });
    },
  });
  const cancelMutation = useMutation({
    mutationFn: (id: string) => cancelBibliographyImport(workspaceId, id),
  });
  const reset = (): void => {
    setFile(null);
    setPreview(null);
    setResult(null);
    setDecisions(new Map());
    setLocalError(null);
    previewMutation.reset();
    confirmMutation.reset();
    if (input.current) input.current.value = '';
  };
  const close = (): void => {
    if (
      previewMutation.isPending ||
      confirmMutation.isPending ||
      cancelMutation.isPending
    )
      return;
    if (preview?.status === 'PREVIEWED' && result === null) {
      cancelMutation.mutate(preview.id, {
        onSuccess: () => {
          reset();
          onClose();
        },
      });
    } else {
      reset();
      onClose();
    }
  };
  const choose = (record: BibliographyPreviewRecord, value: string): void => {
    const [action, targetId] = value.split(':');
    const next = new Map(decisions);
    next.set(record.recordNumber, {
      recordNumber: record.recordNumber,
      action: action as BibliographyDecision['action'],
      ...(targetId ? { targetId } : {}),
    });
    setDecisions(next);
  };
  const error = previewMutation.error ?? confirmMutation.error ?? cancelMutation.error;
  return (
    <Dialog
      open={open}
      onClose={close}
      title={uiText('ui.BibliographyImportDialog.message002')}
      description={uiText('ui.BibliographyImportDialog.message003')}
      className={styles.dialog}
      closeDisabled={
        previewMutation.isPending || confirmMutation.isPending || cancelMutation.isPending
      }
      dismissible={
        !previewMutation.isPending &&
        !confirmMutation.isPending &&
        !cancelMutation.isPending
      }
      footer={
        <div className={styles.footer}>
          <Button
            variant="secondary"
            disabled={
              previewMutation.isPending ||
              confirmMutation.isPending ||
              cancelMutation.isPending
            }
            onClick={close}
          >
            {uiText('ui.InsertAnalysisResult.message019')}
          </Button>
          {preview && result === null ? (
            <Button
              disabled={confirmMutation.isPending}
              onClick={() => confirmMutation.mutate()}
            >
              {confirmMutation.isPending
                ? uiText('ui.BibliographyImportDialog.message004')
                : uiText('ui.BibliographyImportDialog.message005')}
            </Button>
          ) : result ? (
            <Button onClick={close}>{uiText('ui.AnalysisWidgets.message002')}</Button>
          ) : null}
        </div>
      }
    >
      {result ? (
        <section aria-live="polite" className={styles.summary}>
          <h3>{uiText('ui.BibliographyImportDialog.message006')}</h3>
          <p>
            {result.created} {uiText('ui.BibliographyImportDialog.message007')}{' '}
            {result.linked} {uiText('ui.BibliographyImportDialog.message008')}{' '}
            {result.updated} {uiText('ui.BibliographyImportDialog.message009')}{' '}
            {result.duplicates} {uiText('ui.BibliographyImportDialog.message010')}{' '}
            {result.skipped} {uiText('ui.BibliographyImportDialog.message011')}{' '}
            {result.rejected} {uiText('ui.BibliographyImportDialog.message012')}
          </p>
          <p>{uiText('ui.BibliographyImportDialog.message013')}</p>
        </section>
      ) : preview ? (
        <>
          <div className={styles.summary} role="status">
            <strong>{preview.fileName}</strong>
            <span>
              {preview.totalRecords} {uiText('ui.BibliographyImportDialog.message014')}{' '}
              {preview.ready} {uiText('ui.BibliographyImportDialog.message015')}{' '}
              {preview.duplicates} {uiText('ui.BibliographyImportDialog.message010')}{' '}
              {preview.conflicts} {uiText('ui.BibliographyImportDialog.message016')}{' '}
              {preview.rejected} {uiText('ui.BibliographyImportDialog.message012')}
            </span>
          </div>
          <p>{uiText('ui.BibliographyImportDialog.message017')}</p>
          <ol className={styles.records}>
            {preview.records.map((record) => {
              const sourceMatches = record.matches.filter(
                (match) => match.kind === 'SOURCE',
              );
              const selected = decisions.get(record.recordNumber);
              return (
                <li key={`${record.recordNumber}-${record.location}`}>
                  <div className={styles.recordHeading}>
                    <strong>{title(record)}</strong>
                    <Badge
                      tone={statusTone(record.status)}
                      icon={
                        record.status === 'READY'
                          ? 'check'
                          : record.status === 'DUPLICATE'
                            ? 'info'
                            : 'warn'
                      }
                      label={record.status}
                    />
                  </div>
                  <p>
                    {uiText('ui.BibliographyImportDialog.message018')}{' '}
                    {record.recordNumber} · {record.location}
                    {record.bibliography?.authors.length
                      ? ` · ${record.bibliography.authors.join('; ')}`
                      : ''}
                    {record.bibliography?.publicationYear
                      ? ` · ${String(record.bibliography.publicationYear)}`
                      : ''}
                  </p>
                  {record.collections.length || record.tags.length ? (
                    <p>{[...record.collections, ...record.tags].join(' · ')}</p>
                  ) : null}
                  {record.ignoredAttachments > 0 ? (
                    <p>
                      {record.ignoredAttachments}{' '}
                      {uiText('ui.BibliographyImportDialog.message019')}
                    </p>
                  ) : null}
                  {record.bibliography ? (
                    <p>
                      {record.itemType}
                      {record.bibliography.doi
                        ? ' ' +
                          uiText('ui.BibliographyImportDialog.message020', {
                            value0: record.bibliography.doi,
                          })
                        : ''}
                      {record.bibliography.venue ? ` · ${record.bibliography.venue}` : ''}
                      {record.bibliography.citationKey
                        ? ' ' +
                          uiText('ui.BibliographyImportDialog.message021', {
                            value0: record.bibliography.citationKey,
                          })
                        : ''}
                    </p>
                  ) : null}
                  {record.issues.map((issue) => (
                    <p key={issue} className={styles.issue}>
                      {issue}
                    </p>
                  ))}
                  {record.matches.map((match) => (
                    <div key={`${match.kind}-${match.id}`}>
                      <p>
                        {uiText('ui.BibliographyImportDialog.message022')}{' '}
                        {match.kind === 'SOURCE'
                          ? uiText('ui.DocumentSources.message004')
                          : uiText('ui.BibliographyImportDialog.message023')}{' '}
                        “{match.title}
                        {uiText('ui.BibliographyImportDialog.message024')}{' '}
                        {match.reason.toLowerCase()}
                        {match.conflictingFields.length
                          ? uiText('ui.BibliographyImportDialog.message025', {
                              value0: match.conflictingFields.join(', '),
                            })
                          : ''}
                        .
                        {match.tags?.length || match.collections?.length ? (
                          <span>
                            {' '}
                            {uiText('ui.BibliographyImportDialog.message026')}{' '}
                            {[...(match.tags ?? []), ...(match.collections ?? [])].join(
                              ' · ',
                            )}
                            .
                          </span>
                        ) : null}
                      </p>
                      {match.existingBibliography ? (
                        <details>
                          <summary>
                            {uiText('ui.BibliographyImportDialog.message027')}{' '}
                            {match.title}
                          </summary>
                          <p>
                            {match.existingBibliography.authors.join('; ') ||
                              uiText('ui.BibliographyImportDialog.message028')}{' '}
                            ·{' '}
                            {match.existingBibliography.publicationYear ??
                              uiText('ui.BibliographyImportDialog.message029')}
                          </p>
                          <p>
                            {uiText('ui.BibliographyImportDialog.message030')}{' '}
                            {match.existingBibliography.doi ??
                              uiText('ui.BibliographyImportDialog.message031')}{' '}
                            {uiText('ui.BibliographyImportDialog.message032')}{' '}
                            {match.existingBibliography.venue ??
                              uiText('ui.BibliographyImportDialog.message031')}
                          </p>
                          <p>
                            {uiText('ui.BibliographyImportDialog.message033')}{' '}
                            {match.existingBibliography.citationKey ??
                              uiText('ui.BibliographyImportDialog.message031')}
                          </p>
                          <p>
                            {uiText('ui.BibliographyImportDialog.message034')}{' '}
                            {match.existingBibliography.url ??
                              uiText('ui.BibliographyImportDialog.message031')}
                          </p>
                        </details>
                      ) : null}
                    </div>
                  ))}
                  {record.status === 'READY' ? (
                    <p>{uiText('ui.BibliographyImportDialog.message035')}</p>
                  ) : null}
                  {record.status === 'CONFLICT' &&
                  record.matches.length === 0 &&
                  record.bibliography ? (
                    <TextField
                      label={uiText('ui.BibliographyImportDialog.message036', {
                        value0: String(record.recordNumber),
                      })}
                      defaultValue={record.bibliography.citationKey ?? ''}
                      maxLength={100}
                      disabled={confirmMutation.isPending}
                      onChange={(event) => {
                        const next = new Map(decisions);
                        next.set(record.recordNumber, {
                          recordNumber: record.recordNumber,
                          action: 'CREATE',
                          acceptedBibliography: {
                            ...record.bibliography!,
                            citationKey: event.target.value.trim() || null,
                          },
                        });
                        setDecisions(next);
                      }}
                    />
                  ) : null}
                  {record.status !== 'REJECTED' ? (
                    <Select
                      label={uiText('ui.BibliographyImportDialog.message037', {
                        value0: String(record.recordNumber),
                      })}
                      disabled={confirmMutation.isPending}
                      value={
                        selected
                          ? `${selected.action}${selected.targetId ? `:${selected.targetId}` : ''}`
                          : record.status === 'READY'
                            ? 'CREATE'
                            : 'SKIP'
                      }
                      onChange={(event) => choose(record, event.target.value)}
                    >
                      {record.status === 'READY' || selected?.acceptedBibliography ? (
                        <option value="CREATE">
                          {uiText('ui.BibliographyImportDialog.message038')}
                        </option>
                      ) : null}
                      <option value="SKIP">
                        {uiText('ui.BibliographyImportDialog.message039')}
                      </option>
                      {(sources.data ?? [])
                        .filter(
                          (source) =>
                            !sourceMatches.some((match) => match.id === source.id),
                        )
                        .map((source) => (
                          <option
                            key={`source-${source.id}`}
                            value={`LINK_SOURCE:${source.id}`}
                          >
                            {uiText('ui.BibliographyImportDialog.message040')}{' '}
                            {source.displayName}
                          </option>
                        ))}
                      {sourceMatches.map((match) => (
                        <option
                          key={`link-${match.id}`}
                          value={`LINK_SOURCE:${match.id}`}
                        >
                          {uiText('ui.BibliographyImportDialog.message040')} {match.title}
                        </option>
                      ))}
                      {sourceMatches.map((match) => (
                        <option
                          key={`replace-${match.id}`}
                          value={`REPLACE_SOURCE:${match.id}`}
                        >
                          {uiText('ui.BibliographyImportDialog.message041')} {match.title}
                        </option>
                      ))}
                      {record.matches
                        .filter((match) => match.kind === 'BIBLIOGRAPHIC_ITEM')
                        .map((match) => (
                          <option
                            key={`replace-item-${match.id}`}
                            value={`REPLACE_ITEM:${match.id}`}
                          >
                            {uiText('ui.BibliographyImportDialog.message042')}{' '}
                            {match.title}
                          </option>
                        ))}
                    </Select>
                  ) : null}
                  {selected?.targetId ? (
                    <label>
                      <input
                        type="checkbox"
                        checked={selected.mergeOrganization ?? false}
                        disabled={confirmMutation.isPending}
                        onChange={(event) => {
                          const next = new Map(decisions);
                          next.set(record.recordNumber, {
                            ...selected,
                            mergeOrganization: event.target.checked,
                          });
                          setDecisions(next);
                        }}
                      />
                      {uiText('ui.BibliographyImportDialog.message043')}
                    </label>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </>
      ) : (
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            if (file === null) {
              setLocalError(uiText('bibliography.chooseFile'));
              return;
            }
            previewMutation.mutate();
          }}
        >
          <Select
            label={uiText('ui.BibliographyImportDialog.message044')}
            value={origin}
            onChange={(event) => setOrigin(event.target.value as BibliographyOrigin)}
          >
            <option value="GENERIC">
              {uiText('ui.BibliographyImportDialog.message045')}
            </option>
            <option value="ZOTERO">
              {uiText('ui.BibliographyImportDialog.message046')}
            </option>
            <option value="MENDELEY">
              {uiText('ui.BibliographyImportDialog.message047')}
            </option>
          </Select>
          <label htmlFor="bibliography-file">
            {uiText('ui.BibliographyImportDialog.message048')}
          </label>
          <input
            ref={input}
            id="bibliography-file"
            type="file"
            accept=".bib,.ris,.json,application/x-bibtex,application/json,text/plain"
            onChange={(event) => {
              const selected = event.target.files?.[0] ?? null;
              if (selected && selected.size > MAX_BYTES) {
                setFile(null);
                setLocalError(uiText('bibliography.oversized'));
              } else {
                setFile(selected);
                setLocalError(null);
              }
            }}
          />
          <p>{uiText('ui.BibliographyImportDialog.message049')}</p>
          <Button type="submit" disabled={previewMutation.isPending}>
            {previewMutation.isPending
              ? uiText('ui.BibliographyImportDialog.message050')
              : uiText('ui.BibliographyImportDialog.message051')}
          </Button>
        </form>
      )}
      {localError ? <p role="alert">{localError}</p> : null}
      {error ? (
        <p role="alert">
          {uiText('ui.BibliographyImportDialog.message052')} {describeError(error)}
        </p>
      ) : null}
    </Dialog>
  );
}
