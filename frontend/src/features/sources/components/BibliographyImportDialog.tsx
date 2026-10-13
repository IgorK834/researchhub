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
    record.bibliography?.title ?? record.bibliography?.citationKey ?? 'Rejected record'
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
      if (file === null) throw new Error('Choose a bibliography file first.');
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
      title="Import bibliography"
      description="Preview a local BibTeX, RIS, Zotero, or Mendeley export before saving metadata."
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
            Cancel
          </Button>
          {preview && result === null ? (
            <Button
              disabled={confirmMutation.isPending}
              onClick={() => confirmMutation.mutate()}
            >
              {confirmMutation.isPending ? 'Confirming…' : 'Confirm import'}
            </Button>
          ) : result ? (
            <Button onClick={close}>Done</Button>
          ) : null}
        </div>
      }
    >
      {result ? (
        <section aria-live="polite" className={styles.summary}>
          <h3>Import complete</h3>
          <p>
            {result.created} created · {result.linked} linked · {result.updated} updated ·{' '}
            {result.duplicates} duplicates · {result.skipped} skipped · {result.rejected}{' '}
            rejected
          </p>
          <p>
            Bibliographic-only entries remain outside source retrieval and Gemini
            evidence.
          </p>
        </section>
      ) : preview ? (
        <>
          <div className={styles.summary} role="status">
            <strong>{preview.fileName}</strong>
            <span>
              {preview.totalRecords} records · {preview.ready} ready ·{' '}
              {preview.duplicates} duplicates · {preview.conflicts} conflicts ·{' '}
              {preview.rejected} rejected
            </span>
          </div>
          <p>
            Existing source metadata is changed only when you explicitly choose “Replace
            source metadata”. Attachment paths and URLs are never opened or downloaded.
          </p>
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
                    Record {record.recordNumber} · {record.location}
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
                    <p>{record.ignoredAttachments} attachment reference(s) ignored.</p>
                  ) : null}
                  {record.bibliography ? (
                    <p>
                      {record.itemType}
                      {record.bibliography.doi
                        ? ` · DOI: ${record.bibliography.doi}`
                        : ''}
                      {record.bibliography.venue ? ` · ${record.bibliography.venue}` : ''}
                      {record.bibliography.citationKey
                        ? ` · Key: ${record.bibliography.citationKey}`
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
                        Matches {match.kind === 'SOURCE' ? 'source' : 'bibliography item'}{' '}
                        “{match.title}” by {match.reason.toLowerCase()}
                        {match.conflictingFields.length
                          ? `; differs in ${match.conflictingFields.join(', ')}`
                          : ''}
                        .
                        {match.tags?.length || match.collections?.length ? (
                          <span>
                            {' '}
                            Existing labels:{' '}
                            {[...(match.tags ?? []), ...(match.collections ?? [])].join(
                              ' · ',
                            )}
                            .
                          </span>
                        ) : null}
                      </p>
                      {match.existingBibliography ? (
                        <details>
                          <summary>Existing metadata: {match.title}</summary>
                          <p>
                            {match.existingBibliography.authors.join('; ') ||
                              'No authors'}{' '}
                            · {match.existingBibliography.publicationYear ?? 'No date'}
                          </p>
                          <p>
                            DOI: {match.existingBibliography.doi ?? 'Not set'} · Venue:{' '}
                            {match.existingBibliography.venue ?? 'Not set'}
                          </p>
                          <p>
                            Citation key:{' '}
                            {match.existingBibliography.citationKey ?? 'Not set'}
                          </p>
                          <p>
                            URL (metadata only):{' '}
                            {match.existingBibliography.url ?? 'Not set'}
                          </p>
                        </details>
                      ) : null}
                    </div>
                  ))}
                  {record.status === 'READY' ? (
                    <p>Will create a bibliographic-only entry.</p>
                  ) : null}
                  {record.status === 'CONFLICT' &&
                  record.matches.length === 0 &&
                  record.bibliography ? (
                    <TextField
                      label={`Citation key for record ${String(record.recordNumber)}`}
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
                      label={`Decision for record ${String(record.recordNumber)}`}
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
                        <option value="CREATE">Create bibliography entry</option>
                      ) : null}
                      <option value="SKIP">Keep existing metadata / skip</option>
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
                            Link to source: {source.displayName}
                          </option>
                        ))}
                      {sourceMatches.map((match) => (
                        <option
                          key={`link-${match.id}`}
                          value={`LINK_SOURCE:${match.id}`}
                        >
                          Link to source: {match.title}
                        </option>
                      ))}
                      {sourceMatches.map((match) => (
                        <option
                          key={`replace-${match.id}`}
                          value={`REPLACE_SOURCE:${match.id}`}
                        >
                          Replace source metadata: {match.title}
                        </option>
                      ))}
                      {record.matches
                        .filter((match) => match.kind === 'BIBLIOGRAPHIC_ITEM')
                        .map((match) => (
                          <option
                            key={`replace-item-${match.id}`}
                            value={`REPLACE_ITEM:${match.id}`}
                          >
                            Replace bibliography metadata: {match.title}
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
                      Add imported tags and collections
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
              setLocalError('Choose a bibliography file first.');
              return;
            }
            previewMutation.mutate();
          }}
        >
          <Select
            label="Export source"
            value={origin}
            onChange={(event) => setOrigin(event.target.value as BibliographyOrigin)}
          >
            <option value="GENERIC">BibTeX, RIS, or CSL-JSON</option>
            <option value="ZOTERO">Zotero export</option>
            <option value="MENDELEY">Mendeley export</option>
          </Select>
          <label htmlFor="bibliography-file">Bibliography file</label>
          <input
            ref={input}
            id="bibliography-file"
            type="file"
            accept=".bib,.ris,.json,application/x-bibtex,application/json,text/plain"
            onChange={(event) => {
              const selected = event.target.files?.[0] ?? null;
              if (selected && selected.size > MAX_BYTES) {
                setFile(null);
                setLocalError('Bibliography files must be at most 2 MiB.');
              } else {
                setFile(selected);
                setLocalError(null);
              }
            }}
          />
          <p>
            UTF-8 · maximum 2 MiB and 1000 records. No live synchronization or
            credentials.
          </p>
          <Button type="submit" disabled={previewMutation.isPending}>
            {previewMutation.isPending ? 'Reading preview…' : 'Preview import'}
          </Button>
        </form>
      )}
      {localError ? <p role="alert">{localError}</p> : null}
      {error ? <p role="alert">Import failed: {describeError(error)}</p> : null}
    </Dialog>
  );
}
