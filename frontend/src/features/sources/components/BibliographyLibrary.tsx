import { useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { describeError } from '../../../shared/api';
import { Button } from '../../../shared/components/Button';
import { TextField } from '../../../shared/components/forms';
import { Dialog } from '../../../shared/components/overlays';
import {
  fetchBibliographyItems,
  saveBibliographyItem,
  type BibliographyItem,
} from '../api/bibliographyImportApi';
import styles from './BibliographyImportDialog.module.css';

export function BibliographyLibrary({
  workspaceId,
  canEdit,
}: {
  readonly workspaceId: string;
  readonly canEdit: boolean;
}): ReactElement {
  const [offset, setOffset] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState<BibliographyItem | null>(null);
  const library = useQuery({
    queryKey: ['bibliography', workspaceId, offset],
    queryFn: ({ signal }) => fetchBibliographyItems(workspaceId, offset, signal),
    retry: false,
    enabled: expanded,
  });
  return (
    <section aria-label="Imported bibliography">
      <h2>Bibliography</h2>
      <p>
        Saved references and collections. Add a source file separately to use its content
        as evidence.
      </p>
      <Button
        variant="secondary"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? 'Hide bibliography' : 'Show bibliography'}
      </Button>
      {expanded ? (
        <>
          {library.isPending ? <p role="status">Loading bibliography…</p> : null}
          {library.error ? (
            <p role="alert">
              Could not load bibliography: {describeError(library.error)}
            </p>
          ) : null}
          {library.data?.items.length === 0 ? (
            <p>No bibliography entries yet. Import a file to add references.</p>
          ) : null}
          <ul className={styles.records}>
            {library.data?.items.map((item) => (
              <li key={item.id}>
                <strong>
                  {item.bibliography.title ??
                    item.bibliography.citationKey ??
                    'Untitled reference'}
                </strong>
                <p>
                  {item.bibliography.authors.join('; ')}
                  {item.bibliography.publicationYear
                    ? ` · ${String(item.bibliography.publicationYear)}`
                    : ''}
                </p>
                <p>
                  {item.itemType} · {[...item.tags, ...item.collections].join(' · ')}
                </p>
                {item.bibliography.doi ? <p>DOI: {item.bibliography.doi}</p> : null}
                {canEdit ? (
                  <Button variant="secondary" onClick={() => setEditing(item)}>
                    Edit reference
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
          {offset > 0 ? (
            <Button
              variant="secondary"
              onClick={() => setOffset(Math.max(0, offset - 50))}
            >
              Previous references
            </Button>
          ) : null}
          {library.data && library.data.nextOffset >= 0 ? (
            <Button
              variant="secondary"
              onClick={() => setOffset(library.data!.nextOffset)}
            >
              Next references
            </Button>
          ) : null}
          {editing ? (
            <BibliographyEditor
              key={editing.id}
              workspaceId={workspaceId}
              item={editing}
              onClose={() => setEditing(null)}
            />
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function BibliographyEditor({
  workspaceId,
  item,
  onClose,
}: {
  readonly workspaceId: string;
  readonly item: BibliographyItem;
  readonly onClose: () => void;
}): ReactElement {
  const cache = useQueryClient();
  const save = useMutation({
    mutationFn: (updated: BibliographyItem) => saveBibliographyItem(workspaceId, updated),
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: ['bibliography', workspaceId] });
      onClose();
    },
  });
  const submit = (form: HTMLFormElement): void => {
    const data = new FormData(form);
    const text = (key: string): string => String(data.get(key) ?? '').trim();
    const optional = (key: string): string | null => text(key) || null;
    const labels = (key: string): string[] =>
      text(key)
        .split(';')
        .map((label) => label.trim())
        .filter(Boolean);
    save.mutate({
      ...item,
      bibliography: {
        title: optional('title'),
        authors: labels('authors'),
        publicationYear: text('year') ? Number(text('year')) : null,
        doi: optional('doi'),
        venue: optional('venue'),
        url: optional('url'),
        citationKey: optional('citationKey'),
      },
      tags: labels('tags'),
      collections: labels('collections'),
    });
  };
  return (
    <Dialog
      open
      title="Edit bibliography reference"
      onClose={() => {
        if (!save.isPending) onClose();
      }}
      closeDisabled={save.isPending}
      dismissible={!save.isPending}
    >
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          submit(event.currentTarget);
        }}
      >
        <TextField
          label="Title"
          name="title"
          defaultValue={item.bibliography.title ?? ''}
          maxLength={1000}
        />
        <TextField
          label="Authors (semicolon-separated)"
          name="authors"
          defaultValue={item.bibliography.authors.join('; ')}
        />
        <TextField
          label="Publication year"
          name="year"
          type="number"
          min={1}
          max={9999}
          defaultValue={item.bibliography.publicationYear ?? ''}
        />
        <TextField
          label="DOI"
          name="doi"
          defaultValue={item.bibliography.doi ?? ''}
          maxLength={300}
        />
        <TextField
          label="Venue"
          name="venue"
          defaultValue={item.bibliography.venue ?? ''}
          maxLength={500}
        />
        <TextField
          label="Reference URL"
          name="url"
          defaultValue={item.bibliography.url ?? ''}
          maxLength={2000}
        />
        <TextField
          label="Citation key"
          name="citationKey"
          defaultValue={item.bibliography.citationKey ?? ''}
          maxLength={100}
        />
        <TextField
          label="Tags (semicolon-separated)"
          name="tags"
          defaultValue={item.tags.join('; ')}
        />
        <TextField
          label="Collections (semicolon-separated)"
          name="collections"
          defaultValue={item.collections.join('; ')}
        />
        {save.error ? (
          <p role="alert">Could not save reference: {describeError(save.error)}</p>
        ) : null}
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save reference'}
        </Button>
      </form>
    </Dialog>
  );
}
