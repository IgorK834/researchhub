import { getIntlLocale } from '../../../shared/i18n';
import { t as uiText, useLocale as useUiLocale } from '../../../shared/i18n';
import { useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';

import { describeError } from '../../../shared/api';
import { Button } from '../../../shared/components/Button';
import { Illustration } from '../../../shared/components/Illustration';
import { DataTable, EmptyState, IconTile } from '../../../shared/components/content';
import { TextField } from '../../../shared/components/forms';
import type { DocumentSummary } from '../api/documentApi';
import { useDocumentsQuery } from '../api/useDocuments';
import { CreateDocumentDialog } from './CreateDocumentDialog';
import { DocumentRowActions } from './DocumentRowActions';
import styles from './Documents.module.css';

export interface DocumentListProps {
  readonly workspaceId: string;
  readonly currentDocumentId?: string;
  /** Resolved by the page from workspaceCapabilities; the server authorizes every write. */
  readonly canEdit?: boolean;
  readonly onCreated?: (id: string) => void;
  readonly variant?: 'table' | 'column';
}

export function documentTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString(getIntlLocale());
}

/** Summaries only. A rename fetches the full document before a revision-checked update. */
export function DocumentList({
  workspaceId,
  currentDocumentId,
  canEdit = false,
  onCreated,
  variant = 'table',
}: DocumentListProps): ReactElement {
  useUiLocale();
  const { data: documents, error, isPending } = useDocumentsQuery(workspaceId);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('updated');
  const [creating, setCreating] = useState(false);
  const column = variant === 'column';
  const rows = (documents ?? [])
    .filter((document) =>
      document.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
    )
    .sort((a, b) => {
      if (sort === 'title') return a.title.localeCompare(b.title);
      if (sort === 'revision')
        return b.revision - a.revision || a.title.localeCompare(b.title);
      return b.updatedAt.localeCompare(a.updatedAt) || a.title.localeCompare(b.title);
    });
  const path = (id: string): string => `/app/workspaces/${workspaceId}/documents/${id}`;
  const Heading = column ? 'h2' : 'h1';

  return (
    <section
      aria-labelledby="workspace-documents-heading"
      className={column ? styles.columnList : styles.listPage}
    >
      <header className={styles.listHeader}>
        <div>
          <Heading id="workspace-documents-heading">
            {uiText('ui.DocumentList.message001')}
          </Heading>
          {!column && documents !== undefined && error === null ? (
            <p className={styles.meta}>
              {uiText('documents.count', { count: documents.length })}
            </p>
          ) : null}
        </div>
        {canEdit ? (
          column ? (
            <Button
              icon="plus"
              iconOnly
              aria-label={uiText('ui.DocumentList.message004')}
              variant="ghost"
              onClick={() => setCreating(true)}
            />
          ) : (
            <Button
              icon="plus"
              variant={column ? 'ghost' : 'primary'}
              onClick={() => setCreating(true)}
            >
              {uiText('ui.DocumentList.message004')}
            </Button>
          )
        ) : null}
      </header>
      {isPending ? <p role="status">{uiText('ui.DocumentList.message005')}</p> : null}
      {error !== null && !isPending ? (
        <p role="alert">
          {uiText('ui.DocumentList.message006')} {describeError(error)}
        </p>
      ) : null}
      {documents !== undefined && error === null ? (
        documents.length === 0 ? (
          <EmptyState
            title={uiText('ui.DocumentList.message007')}
            description={uiText('ui.DocumentList.message008')}
            art={<Illustration scene="documents" size={column ? 'compact' : 'default'} />}
            size={column ? 'compact' : 'default'}
            tone="lavender"
            actions={
              canEdit
                ? [
                    <Button key="create" icon="plus" onClick={() => setCreating(true)}>
                      {uiText('ui.DocumentList.message009')}
                    </Button>,
                  ]
                : undefined
            }
          />
        ) : column ? (
          <ul className={styles.documentLinks}>
            {documents.map((document) => (
              <li key={document.id}>
                <Link
                  to={path(document.id)}
                  aria-current={document.id === currentDocumentId ? 'page' : undefined}
                >
                  <IconTile icon="file" tone="coral" size="small" />
                  {document.title}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <>
            <div className={styles.filters}>
              <TextField
                label={uiText('ui.DocumentList.message010')}
                type="search"
                placeholder={uiText('ui.DocumentList.message011')}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <label>
                {uiText('ui.DocumentList.message012')}
                <select value={sort} onChange={(event) => setSort(event.target.value)}>
                  <option value="updated">{uiText('ui.DocumentList.message013')}</option>
                  <option value="title">{uiText('ui.DocumentList.message014')}</option>
                  <option value="revision">
                    {uiText('ui.DocumentHistory.message019')}
                  </option>
                </select>
              </label>
            </div>
            {rows.length === 0 ? (
              <EmptyState
                art={<Illustration scene="search" />}
                tone="blue"
                title={uiText('ui.DocumentList.message015')}
                description={uiText('ui.DocumentList.message016')}
                actions={[
                  <Button key="clear" variant="secondary" onClick={() => setSearch('')}>
                    {uiText('ui.DocumentList.message017')}
                  </Button>,
                ]}
              />
            ) : (
              <DataTable<DocumentSummary>
                caption={uiText('ui.DocumentList.message018')}
                label={uiText('ui.DocumentList.message001')}
                rows={rows}
                rowKey={(row) => row.id}
                columns={[
                  {
                    id: 'title',
                    get header() {
                      return uiText('ui.DocumentEditorForm.message013');
                    },
                    rowHeader: true,
                    render: (row) => (
                      <div className={styles.documentTitle}>
                        <IconTile icon="file" tone="coral" />
                        <Link to={path(row.id)}>{row.title}</Link>
                      </div>
                    ),
                  },
                  {
                    id: 'revision',
                    get header() {
                      return uiText('ui.DocumentHistory.message019');
                    },
                    render: (row) => <span className={styles.meta}>v{row.revision}</span>,
                  },
                  {
                    id: 'updated',
                    get header() {
                      return uiText('ui.DocumentList.message019');
                    },
                    render: (row) => (
                      <time dateTime={row.updatedAt} className={styles.meta}>
                        {documentTime(row.updatedAt)}
                      </time>
                    ),
                  },
                  {
                    id: 'actions',
                    get header() {
                      return uiText('ui.DocumentList.message020');
                    },
                    render: (row) => (
                      <div className={styles.rowActions}>
                        <Link
                          to={path(row.id)}
                          className={styles.open}
                          aria-label={uiText('ui.DocumentList.message021', {
                            value0: row.title,
                          })}
                        >
                          {uiText('ui.ClaimEvidencePanel.message011')}
                        </Link>
                        {canEdit ? (
                          <DocumentRowActions workspaceId={workspaceId} document={row} />
                        ) : null}
                      </div>
                    ),
                  },
                ]}
              />
            )}
          </>
        )
      ) : null}
      {canEdit ? (
        <CreateDocumentDialog
          workspaceId={workspaceId}
          open={creating}
          onClose={() => setCreating(false)}
          onCreated={onCreated}
        />
      ) : null}
    </section>
  );
}
