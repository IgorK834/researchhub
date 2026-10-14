import { t as uiText, useLocale as useUiLocale } from '../../../shared/i18n';
import { useState, type ReactElement } from 'react';
import { describeError } from '../../../shared/api';
import { Button } from '../../../shared/components/Button';
import { Panel } from '../../../shared/components/content';
import { TextField, Textarea } from '../../../shared/components/forms';
import { Dialog } from '../../../shared/components/overlays';
import type { WorkspaceSource } from '../api/sourceApi';
import { useSaveSourceDetails } from '../api/useSources';
import styles from './SourceMetadata.module.css';

export function SourceMetadataPanel({
  source,
  canEdit,
}: {
  readonly source: WorkspaceSource;
  readonly canEdit: boolean;
}): ReactElement {
  useUiLocale();
  const [open, setOpen] = useState(false);
  const metadata = source.bibliography ?? {
    title: null,
    authors: [],
    publicationYear: null,
    doi: null,
    venue: null,
    url: null,
    citationKey: null,
  };
  return (
    <Panel title={uiText('ui.SourceMetadataPanel.message001')} className={styles.panel}>
      <p className={styles.hint}>{uiText('ui.SourceMetadataPanel.message002')}</p>
      <dl className={styles.details}>
        <dt>{uiText('ui.DocumentEditorForm.message013')}</dt>
        <dd>{metadata.title ?? uiText('ui.BibliographyImportDialog.message031')}</dd>
        <dt>{uiText('ui.SourceMetadataPanel.message003')}</dt>
        <dd>
          {metadata.authors.join('; ') ||
            uiText('ui.BibliographyImportDialog.message031')}
        </dd>
        <dt>{uiText('ui.BibliographyLibrary.message015')}</dt>
        <dd>
          {metadata.publicationYear ?? uiText('ui.BibliographyImportDialog.message031')}
        </dd>
        <dt>{uiText('ui.SourceMetadataPanel.message004')}</dt>
        <dd>{metadata.venue ?? uiText('ui.BibliographyImportDialog.message031')}</dd>
        <dt>DOI</dt>
        <dd>{metadata.doi ?? uiText('ui.BibliographyImportDialog.message031')}</dd>
        <dt>{uiText('ui.SourceMetadataPanel.message005')}</dt>
        <dd>
          {metadata.url ? (
            <a href={metadata.url} target="_blank" rel="noopener noreferrer">
              {metadata.url}
            </a>
          ) : (
            uiText('ui.BibliographyImportDialog.message031')
          )}
        </dd>
        <dt>{uiText('ui.BibliographyLibrary.message018')}</dt>
        <dd>
          {metadata.citationKey ?? uiText('ui.BibliographyImportDialog.message031')}
        </dd>
        <dt>{uiText('ui.SourceMetadataPanel.message006')}</dt>
        <dd>
          {(source.tags ?? []).join(' · ') || uiText('ui.ProvenancePanel.message022')}
        </dd>
        <dt>{uiText('ui.SourceMetadataPanel.message007')}</dt>
        <dd>
          {(source.collections ?? []).join(' · ') ||
            uiText('ui.ProvenancePanel.message022')}
        </dd>
      </dl>
      {canEdit ? (
        <Button variant="secondary" icon="pencil" onClick={() => setOpen(true)}>
          {uiText('ui.SourceMetadataPanel.message008')}
        </Button>
      ) : null}
      {open && canEdit ? (
        <SourceMetadataEditor source={source} onClose={() => setOpen(false)} />
      ) : null}
    </Panel>
  );
}

function lines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function SourceMetadataEditor({
  source,
  onClose,
}: {
  readonly source: WorkspaceSource;
  readonly onClose: () => void;
}): ReactElement {
  useUiLocale();
  const [metadata, setMetadata] = useState(source.bibliography);
  const [authors, setAuthors] = useState(metadata.authors.join('\n'));
  const [name, setName] = useState(source.displayName);
  const [tags, setTags] = useState(source.tags.join('\n'));
  const [collections, setCollections] = useState(source.collections.join('\n'));
  const { bibliography, lookup, organization } = useSaveSourceDetails(
    source.workspaceId,
    source.id,
  );
  const fields = [
    ['title', uiText('ui.DocumentEditorForm.message013'), 1000],
    ['venue', uiText('ui.SourceMetadataPanel.message004'), 500],
    ['url', 'URL', 2000],
    ['citationKey', uiText('ui.BibliographyLibrary.message018'), 100],
  ] as const;
  return (
    <Dialog
      open
      title={uiText('ui.SourceMetadataPanel.message008')}
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={onClose}>
          {uiText('ui.AnalysisWidgets.message002')}
        </Button>
      }
    >
      <p className={styles.hint}>{uiText('ui.SourceMetadataPanel.message009')}</p>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          bibliography.mutate({ ...metadata, authors: lines(authors) });
        }}
      >
        <h3>{uiText('ui.SourceMetadataPanel.message010')}</h3>
        {fields.map(([key, label, maxLength]) => (
          <TextField
            key={key}
            label={label}
            type={key === 'url' ? 'url' : 'text'}
            maxLength={maxLength}
            value={metadata[key] ?? ''}
            onChange={(event) =>
              setMetadata({ ...metadata, [key]: event.target.value || null })
            }
          />
        ))}
        <div className={styles.lookup}>
          <TextField
            label="DOI"
            type="text"
            maxLength={300}
            value={metadata.doi ?? ''}
            onChange={(event) => {
              lookup.reset();
              setMetadata({ ...metadata, doi: event.target.value || null });
            }}
          />
          <Button
            type="button"
            variant="secondary"
            disabled={lookup.isPending || !metadata.doi?.trim()}
            onClick={() =>
              lookup.mutate(metadata.doi ?? '', {
                onSuccess: (result) => {
                  const suggestion = result.bibliography;
                  setMetadata((current) => ({
                    ...current,
                    title: current.title ?? suggestion.title,
                    publicationYear:
                      current.publicationYear ?? suggestion.publicationYear,
                    doi: current.doi ?? suggestion.doi,
                    venue: current.venue ?? suggestion.venue,
                    url: current.url ?? suggestion.url,
                    citationKey: current.citationKey ?? suggestion.citationKey,
                  }));
                  setAuthors((current) =>
                    lines(current).length === 0 ? suggestion.authors.join('\n') : current,
                  );
                },
              })
            }
          >
            {lookup.isPending
              ? uiText('ui.SourceMetadataPanel.message011')
              : uiText('ui.SourceMetadataPanel.message012')}
          </Button>
        </div>
        {lookup.error ? <p role="alert">{describeError(lookup.error)}</p> : null}
        {lookup.isSuccess ? (
          <p role="status">{uiText('ui.SourceMetadataPanel.message013')}</p>
        ) : null}
        <Textarea
          label={uiText('ui.SourceMetadataPanel.message003')}
          hint={uiText('ui.SourceMetadataPanel.message014')}
          value={authors}
          onChange={(event) => setAuthors(event.target.value)}
        />
        <TextField
          label={uiText('ui.BibliographyLibrary.message015')}
          type="number"
          min={1}
          max={9999}
          step={1}
          value={metadata.publicationYear ?? ''}
          onChange={(event) =>
            setMetadata({
              ...metadata,
              publicationYear:
                event.target.value === '' ? null : Number(event.target.value),
            })
          }
        />
        {bibliography.error ? (
          <p role="alert">{describeError(bibliography.error)}</p>
        ) : null}
        {bibliography.isSuccess ? (
          <p role="status">{uiText('ui.SourceMetadataPanel.message015')}</p>
        ) : null}
        <Button type="submit" disabled={bibliography.isPending}>
          {bibliography.isPending
            ? uiText('ui.SourceMetadataPanel.message016')
            : uiText('ui.SourceMetadataPanel.message017')}
        </Button>
      </form>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          organization.mutate({
            displayName: name,
            tags: lines(tags),
            collections: lines(collections),
          });
        }}
      >
        <h3>{uiText('ui.SourceMetadataPanel.message018')}</h3>
        <TextField
          label={uiText('ui.SourceMetadataPanel.message019')}
          required
          maxLength={255}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <Textarea
          label={uiText('ui.SourceMetadataPanel.message006')}
          hint={uiText('ui.SourceMetadataPanel.message020')}
          value={tags}
          onChange={(event) => setTags(event.target.value)}
        />
        <Textarea
          label={uiText('ui.SourceMetadataPanel.message007')}
          hint={uiText('ui.SourceMetadataPanel.message021')}
          value={collections}
          onChange={(event) => setCollections(event.target.value)}
        />
        {organization.error ? (
          <p role="alert">{describeError(organization.error)}</p>
        ) : null}
        {organization.isSuccess ? (
          <p role="status">{uiText('ui.SourceMetadataPanel.message022')}</p>
        ) : null}
        <Button type="submit" disabled={organization.isPending}>
          {organization.isPending
            ? uiText('ui.SourceMetadataPanel.message023')
            : uiText('ui.SourceMetadataPanel.message024')}
        </Button>
      </form>
    </Dialog>
  );
}
