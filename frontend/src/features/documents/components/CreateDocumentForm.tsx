import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { describeError, fieldErrorsByName, queryKeys } from '../../../shared/api';
import { useI18n, type Locale } from '../../../shared/i18n';
import {
  createDocumentFromTemplate,
  fetchDocumentTemplates,
} from '../api/documentTemplateApi';
import { TemplatePreview } from './TemplatePreview';
import type { WorkspaceDocument } from '../api/documentApi';
import { EMPTY_DOCUMENT } from '../api/documentContent';
import { useCreateDocument } from '../api/useDocuments';
import { Button } from '../../../shared/components/Button';
import { Select, TextField } from '../../../shared/components/forms';
import styles from './Documents.module.css';

interface CreateDocumentFormProps {
  readonly workspaceId: string;
  /** Called with the new document, so the page can open it. */
  readonly onCreated?: (document: WorkspaceDocument) => void;
  readonly onPendingChange?: (pending: boolean) => void;
}

/**
 * Starts a new document with a title and an empty body.
 *
 * Only a title is asked for: the text is written on the document's own page, and a create form that also
 * collected the body would be a second editor to keep in step with the first. The content sent is one empty
 * paragraph, which is what an editor needs in order to have somewhere to put a cursor.
 *
 * Rendered only for a member who may edit content, and only while the workspace is active. The server checks
 * `EDIT_CONTENT` on the request regardless, and answers `403` to a viewer.
 */
export function CreateDocumentForm({
  workspaceId,
  onCreated,
  onPendingChange,
}: CreateDocumentFormProps): ReactElement {
  const blank = useCreateDocument(workspaceId);
  const { t, locale } = useI18n();
  const cache = useQueryClient();
  const [mode, setMode] = useState('BLANK');
  const [templateLocale, setTemplateLocale] = useState<Locale>(locale);
  const [selectedId, setSelectedId] = useState('lab-report');
  const templates = useQuery({
    queryKey: ['document-templates', workspaceId, templateLocale],
    queryFn: ({ signal }) => fetchDocumentTemplates(workspaceId, templateLocale, signal),
    enabled: mode === 'TEMPLATE',
    retry: false,
  });
  const selected = templates.data?.find((row) => row.id === selectedId);
  const attempt = useRef<{ payload: string; id: string } | null>(null);
  const fromTemplate = useMutation({
    mutationFn: () => {
      if (!selected) throw new Error(t('templates.error'));
      const input = {
        templateId: selected.id,
        version: selected.version,
        locale: selected.locale,
        title,
      };
      const payload = JSON.stringify(input);
      if (attempt.current?.payload !== payload)
        attempt.current = { payload, id: crypto.randomUUID() };
      return createDocumentFromTemplate(workspaceId, {
        ...input,
        clientRequestId: attempt.current.id,
      });
    },
    onSuccess: (created) => {
      void cache.invalidateQueries({ queryKey: queryKeys.documents(workspaceId) });
      setTitle('');
      attempt.current = null;
      onCreated?.(created);
    },
  });
  const isPending = blank.isPending || fromTemplate.isPending;
  useEffect(() => {
    onPendingChange?.(isPending);
  }, [isPending, onPendingChange]);
  const error = fromTemplate.error ?? blank.error;

  const [title, setTitle] = useState('');

  const fieldErrors = fieldErrorsByName(error);
  const titleError = fieldErrors['title'];
  const formMessage =
    error !== null && Object.keys(fieldErrors).length === 0 ? describeError(error) : null;

  const submit = (): void => {
    if (mode === 'TEMPLATE') {
      fromTemplate.mutate();
      return;
    }
    blank.mutate(
      { title, content: EMPTY_DOCUMENT },
      {
        onSuccess: (created) => {
          setTitle('');
          onCreated?.(created);
        },
      },
    );
  };

  return (
    <section aria-label={t('documents.create.heading')} id="create-document-heading">
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        noValidate
      >
        {formMessage !== null ? <p role="alert">{formMessage}</p> : null}

        <Select
          label={t('templates.choose')}
          value={mode}
          disabled={isPending}
          onChange={(event) => setMode(event.target.value)}
        >
          <option value="BLANK">{t('templates.blank')}</option>
          <option value="TEMPLATE">{t('templates.use')}</option>
        </Select>
        {mode === 'TEMPLATE' ? (
          <>
            <Select
              label={t('templates.locale')}
              value={templateLocale}
              disabled={isPending}
              onChange={(event) => setTemplateLocale(event.target.value as Locale)}
            >
              <option value="en">English</option>
              <option value="pl">Polski</option>
            </Select>
            {templates.isPending ? <p role="status">{t('templates.loading')}</p> : null}
            {templates.error ? (
              <div role="alert">
                <p>
                  {t('templates.error')} {describeError(templates.error)}
                </p>
                <Button type="button" onClick={() => void templates.refetch()}>
                  {t('common.retry')}
                </Button>
              </div>
            ) : null}
            {templates.data ? (
              <Select
                label={t('templates.select')}
                value={selectedId}
                disabled={isPending}
                onChange={(event) => setSelectedId(event.target.value)}
              >
                {templates.data.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.title}
                  </option>
                ))}
              </Select>
            ) : null}
            {selected ? <TemplatePreview template={selected} /> : null}
          </>
        ) : null}

        <TextField
          label={t('documents.create.title')}
          id="document-title"
          name="document-title"
          type="text"
          maxLength={500}
          value={title}
          autoComplete="off"
          disabled={isPending}
          error={titleError}
          onChange={(event) => setTitle(event.target.value)}
        />
        <Button
          type="submit"
          disabled={!title.trim() || (mode === 'TEMPLATE' && !selected)}
          busy={isPending}
          busyLabel={t('documents.create.busy')}
        >
          {t('documents.create.submit')}
        </Button>
      </form>
    </section>
  );
}
