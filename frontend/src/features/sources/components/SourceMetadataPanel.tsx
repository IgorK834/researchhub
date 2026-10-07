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
    <Panel title="Bibliography & organization" className={styles.panel}>
      <p className={styles.hint}>
        Workspace-curated metadata. Links describe this source; they do not add external
        evidence.
      </p>
      <dl className={styles.details}>
        <dt>Title</dt>
        <dd>{metadata.title ?? 'Not set'}</dd>
        <dt>Authors</dt>
        <dd>{metadata.authors.join('; ') || 'Not set'}</dd>
        <dt>Publication year</dt>
        <dd>{metadata.publicationYear ?? 'Not set'}</dd>
        <dt>Journal/conference</dt>
        <dd>{metadata.venue ?? 'Not set'}</dd>
        <dt>DOI</dt>
        <dd>{metadata.doi ?? 'Not set'}</dd>
        <dt>URL</dt>
        <dd>
          {metadata.url ? (
            <a href={metadata.url} target="_blank" rel="noopener noreferrer">
              {metadata.url}
            </a>
          ) : (
            'Not set'
          )}
        </dd>
        <dt>Citation key</dt>
        <dd>{metadata.citationKey ?? 'Not set'}</dd>
        <dt>Tags</dt>
        <dd>{(source.tags ?? []).join(' · ') || 'None'}</dd>
        <dt>Collections</dt>
        <dd>{(source.collections ?? []).join(' · ') || 'None'}</dd>
      </dl>
      {canEdit ? (
        <Button variant="secondary" icon="pencil" onClick={() => setOpen(true)}>
          Edit source details
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
  const [metadata, setMetadata] = useState(source.bibliography);
  const [authors, setAuthors] = useState(metadata.authors.join('\n'));
  const [name, setName] = useState(source.displayName);
  const [tags, setTags] = useState(source.tags.join('\n'));
  const [collections, setCollections] = useState(source.collections.join('\n'));
  const { bibliography, organization } = useSaveSourceDetails(
    source.workspaceId,
    source.id,
  );
  const fields = [
    ['title', 'Title', 1000],
    ['doi', 'DOI', 300],
    ['venue', 'Journal/conference', 500],
    ['url', 'URL', 2000],
    ['citationKey', 'Citation key', 100],
  ] as const;
  return (
    <Dialog
      open
      title="Edit source details"
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <p className={styles.hint}>
        Metadata and labels can change while citations retain the source ID, version and
        original bytes.
      </p>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          bibliography.mutate({ ...metadata, authors: lines(authors) });
        }}
      >
        <h3>Bibliographic metadata</h3>
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
        <Textarea
          label="Authors"
          hint="One author per line, in publication order."
          value={authors}
          onChange={(event) => setAuthors(event.target.value)}
        />
        <TextField
          label="Publication year"
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
        {bibliography.isSuccess ? <p role="status">Bibliography saved.</p> : null}
        <Button type="submit" disabled={bibliography.isPending}>
          {bibliography.isPending ? 'Saving bibliography…' : 'Save bibliography'}
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
        <h3>Library organization</h3>
        <TextField
          label="Display name"
          required
          maxLength={255}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <Textarea
          label="Tags"
          hint="One tag per line. Up to 20 tags, 80 characters each."
          value={tags}
          onChange={(event) => setTags(event.target.value)}
        />
        <Textarea
          label="Collections"
          hint="One collection per line. Use the same label to group sources. Labels are case-insensitive."
          value={collections}
          onChange={(event) => setCollections(event.target.value)}
        />
        {organization.error ? (
          <p role="alert">{describeError(organization.error)}</p>
        ) : null}
        {organization.isSuccess ? <p role="status">Organization saved.</p> : null}
        <Button type="submit" disabled={organization.isPending}>
          {organization.isPending ? 'Saving organization…' : 'Save organization'}
        </Button>
      </form>
    </Dialog>
  );
}
