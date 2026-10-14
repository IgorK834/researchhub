import { t as uiText, useLocale as useUiLocale } from '../../../shared/i18n';
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
  useUiLocale();
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
    <section aria-label={uiText('ui.BibliographyLibrary.message001')}>
      <h2>{uiText('ui.BibliographyLibrary.message002')}</h2>
      <p>{uiText('ui.BibliographyLibrary.message003')}</p>
      <Button
        variant="secondary"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded
          ? uiText('ui.BibliographyLibrary.message004')
          : uiText('ui.BibliographyLibrary.message005')}
      </Button>
      {expanded ? (
        <>
          {library.isPending ? (
            <p role="status">{uiText('ui.BibliographyLibrary.message006')}</p>
          ) : null}
          {library.error ? (
            <p role="alert">
              {uiText('ui.BibliographyLibrary.message007')} {describeError(library.error)}
            </p>
          ) : null}
          {library.data?.items.length === 0 ? (
            <p>{uiText('ui.BibliographyLibrary.message008')}</p>
          ) : null}
          <ul className={styles.records}>
            {library.data?.items.map((item) => (
              <li key={item.id}>
                <strong>
                  {item.bibliography.title ??
                    item.bibliography.citationKey ??
                    uiText('ui.BibliographyLibrary.message009')}
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
                {item.bibliography.doi ? (
                  <p>
                    {uiText('ui.BibliographyImportDialog.message030')}{' '}
                    {item.bibliography.doi}
                  </p>
                ) : null}
                {canEdit ? (
                  <Button variant="secondary" onClick={() => setEditing(item)}>
                    {uiText('ui.BibliographyLibrary.message010')}
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
              {uiText('ui.BibliographyLibrary.message011')}
            </Button>
          ) : null}
          {library.data && library.data.nextOffset >= 0 ? (
            <Button
              variant="secondary"
              onClick={() => setOffset(library.data!.nextOffset)}
            >
              {uiText('ui.BibliographyLibrary.message012')}
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
  useUiLocale();
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
      title={uiText('ui.BibliographyLibrary.message013')}
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
          label={uiText('ui.DocumentEditorForm.message013')}
          name="title"
          defaultValue={item.bibliography.title ?? ''}
          maxLength={1000}
        />
        <TextField
          label={uiText('ui.BibliographyLibrary.message014')}
          name="authors"
          defaultValue={item.bibliography.authors.join('; ')}
        />
        <TextField
          label={uiText('ui.BibliographyLibrary.message015')}
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
          label={uiText('ui.BibliographyLibrary.message016')}
          name="venue"
          defaultValue={item.bibliography.venue ?? ''}
          maxLength={500}
        />
        <TextField
          label={uiText('ui.BibliographyLibrary.message017')}
          name="url"
          defaultValue={item.bibliography.url ?? ''}
          maxLength={2000}
        />
        <TextField
          label={uiText('ui.BibliographyLibrary.message018')}
          name="citationKey"
          defaultValue={item.bibliography.citationKey ?? ''}
          maxLength={100}
        />
        <TextField
          label={uiText('ui.BibliographyLibrary.message019')}
          name="tags"
          defaultValue={item.tags.join('; ')}
        />
        <TextField
          label={uiText('ui.BibliographyLibrary.message020')}
          name="collections"
          defaultValue={item.collections.join('; ')}
        />
        {save.error ? (
          <p role="alert">
            {uiText('ui.BibliographyLibrary.message021')} {describeError(save.error)}
          </p>
        ) : null}
        <Button type="submit" disabled={save.isPending}>
          {save.isPending
            ? uiText('ui.BibliographyLibrary.message022')
            : uiText('ui.BibliographyLibrary.message023')}
        </Button>
      </form>
    </Dialog>
  );
}
