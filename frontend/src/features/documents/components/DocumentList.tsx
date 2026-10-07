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
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

/** Summaries only. A rename fetches the full document before a revision-checked update. */
export function DocumentList({
  workspaceId,
  currentDocumentId,
  canEdit = false,
  onCreated,
  variant = 'table',
}: DocumentListProps): ReactElement {
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
          <Heading id="workspace-documents-heading">Documents</Heading>
          {!column && documents !== undefined && error === null ? (
            <p className={styles.meta}>
              {documents.length} {documents.length === 1 ? 'document' : 'documents'}
            </p>
          ) : null}
        </div>
        {canEdit ? (
          column ? (
            <Button
              icon="plus"
              iconOnly
              aria-label="New document"
              variant="ghost"
              onClick={() => setCreating(true)}
            />
          ) : (
            <Button
              icon="plus"
              variant={column ? 'ghost' : 'primary'}
              onClick={() => setCreating(true)}
            >
              New document
            </Button>
          )
        ) : null}
      </header>
      {isPending ? <p role="status">Loading documents…</p> : null}
      {error !== null && !isPending ? (
        <p role="alert">Could not load the documents: {describeError(error)}</p>
      ) : null}
      {documents !== undefined && error === null ? (
        documents.length === 0 ? (
          <EmptyState
            title="Nothing written yet"
            description="Your research starts with a blank page. Write your first document here."
            art={<Illustration scene="documents" size={column ? 'compact' : 'default'} />}
            size={column ? 'compact' : 'default'}
            tone="lavender"
            actions={
              canEdit
                ? [
                    <Button key="create" icon="plus" onClick={() => setCreating(true)}>
                      Create first document
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
                label="Search documents"
                type="search"
                placeholder="Search by title…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <label>
                Sort documents
                <select value={sort} onChange={(event) => setSort(event.target.value)}>
                  <option value="updated">Last edited</option>
                  <option value="title">Title A–Z</option>
                  <option value="revision">Revision</option>
                </select>
              </label>
            </div>
            {rows.length === 0 ? (
              <EmptyState
                art={<Illustration scene="search" />}
                tone="blue"
                title="No matching documents"
                description="Try another title or clear your search."
                actions={[
                  <Button key="clear" variant="secondary" onClick={() => setSearch('')}>
                    Clear search
                  </Button>,
                ]}
              />
            ) : (
              <DataTable<DocumentSummary>
                caption="Workspace documents"
                label="Documents"
                rows={rows}
                rowKey={(row) => row.id}
                columns={[
                  {
                    id: 'title',
                    header: 'Title',
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
                    header: 'Revision',
                    render: (row) => <span className={styles.meta}>v{row.revision}</span>,
                  },
                  {
                    id: 'updated',
                    header: 'Updated',
                    render: (row) => (
                      <time dateTime={row.updatedAt} className={styles.meta}>
                        {documentTime(row.updatedAt)}
                      </time>
                    ),
                  },
                  {
                    id: 'actions',
                    header: 'Actions',
                    render: (row) => (
                      <div className={styles.rowActions}>
                        <Link
                          to={path(row.id)}
                          className={styles.open}
                          aria-label={`Open ${row.title}`}
                        >
                          Open
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
