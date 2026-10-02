import type { ReactElement, ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { useDocumentsQuery } from '../features/documents/api/useDocuments';
import { useSourcesQuery } from '../features/sources/api/useSources';
import {
  SourceTypeTile,
  SourceTypeBadge,
  SourceStatusChip,
} from '../features/sources/components/SourceVisuals';
import { useWorkspaceMembersQuery } from '../features/workspaces/api/useWorkspaces';
import type { Workspace } from '../features/workspaces/api/workspaceApi';
import { useConversationsQuery } from '../features/ai/api/useConversations';
import { WorkspaceQuestions } from '../features/ai/components/WorkspaceQuestions';
import { workspaceSectionPath } from '../app/workspaceRoutes';
import { describeError } from '../shared/api';
import { IconTile, ListRow, Panel } from '../shared/components/content';
import { Banner, Skeleton } from '../shared/components/feedback';
import { AvatarStack, RoleBadge, Sticker } from '../shared/components/identity';
import styles from '../features/workspaces/components/WorkspaceViews.module.css';

function UpdatedTime({ value }: { readonly value: string }): ReactElement {
  return (
    <time dateTime={value}>
      {new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(value))}
    </time>
  );
}

function CollectionState({
  pending,
  error,
  empty,
  label,
  children,
}: {
  readonly pending: boolean;
  readonly error: Error | null;
  readonly empty: boolean;
  readonly label: string;
  readonly children: ReactNode;
}): ReactElement {
  if (pending)
    return (
      <>
        <p role="status">Loading {label}…</p>
        <Skeleton height={64} shape="block" />
      </>
    );
  if (error !== null)
    return (
      <Banner tone="error" lead={`Could not load ${label}`}>
        {describeError(error)}
      </Banner>
    );
  if (empty) return <p className={styles.quiet}>No {label} yet.</p>;
  return <>{children}</>;
}

/** Route-level composition: existing collections only, with no per-row reads or fabricated metadata. */
export function WorkspaceOverview({
  workspace,
}: {
  readonly workspace: Workspace;
}): ReactElement {
  const documents = useDocumentsQuery(workspace.id);
  const sources = useSourcesQuery(workspace.id);
  const members = useWorkspaceMembersQuery(workspace.id);
  const conversations = useConversationsQuery(workspace.id);
  const navigate = useNavigate();
  const recentDocuments = [...(documents.data ?? [])]
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, 3);
  const recentSources = [...(sources.data ?? [])]
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, 4);
  // The existing endpoint orders conversation summaries by most recent activity.
  const recentConversations = conversations.data?.pages[0]?.items.slice(0, 3) ?? [];
  const readyCount = sources.data?.filter((source) => source.status === 'READY').length;
  return (
    <section className={styles.overview} aria-labelledby="workspace-overview-heading">
      <header className={styles.hero}>
        <RoleBadge role={workspace.role} />
        <h1 id="workspace-overview-heading">{workspace.name}</h1>
        <p className={styles.heroDescription}>
          {workspace.description ?? 'No description.'}
        </p>
        <div className={styles.heroMeta}>
          {members.error === null && members.data !== undefined ? (
            <AvatarStack
              label="Workspace members"
              people={members.data.map((member) => ({
                userId: member.userId,
                name: member.displayName,
              }))}
            />
          ) : null}
          {sources.error === null && readyCount !== undefined ? (
            <Sticker
              icon="sparkle"
              label={`Grounded in ${readyCount} ${readyCount === 1 ? 'source' : 'sources'}`}
            />
          ) : null}
        </div>
        {members.error !== null ? (
          <Banner tone="error" lead="Could not load workspace members">
            {describeError(members.error)}
          </Banner>
        ) : null}
      </header>
      {workspace.archivedAt !== null ? (
        <Banner lead="This workspace is archived.">
          It no longer appears in your workspace list, and its content can no longer be
          changed. Nothing has been deleted.
        </Banner>
      ) : null}
      <WorkspaceQuestions
        workspaceId={workspace.id}
        variant="overview"
        onAsk={(question) => {
          void navigate(workspaceSectionPath(workspace.id, 'ask'), {
            state: { workspaceQuestion: question },
          });
        }}
      />
      <div className={styles.overviewGrid}>
        <div className={styles.recentColumn}>
          <Panel
            title="Recent documents"
            header={
              <Link to={workspaceSectionPath(workspace.id, 'documents')}>
                All documents
              </Link>
            }
          >
            <CollectionState
              pending={documents.isPending}
              error={documents.error}
              empty={recentDocuments.length === 0}
              label="documents"
            >
              <ul className={styles.recentList}>
                {recentDocuments.map((document) => (
                  <ListRow
                    key={document.id}
                    leading={<IconTile icon="file" tone="coral" />}
                    title={
                      <Link
                        className={styles.documentTitle}
                        to={`${workspaceSectionPath(workspace.id, 'documents')}/${encodeURIComponent(document.id)}`}
                      >
                        {document.title}
                      </Link>
                    }
                    meta={
                      <>
                        Updated <UpdatedTime value={document.updatedAt} /> · v
                        {document.revision}
                      </>
                    }
                  />
                ))}
              </ul>
            </CollectionState>
          </Panel>
          <Panel
            title="Recent sources"
            header={
              <Link to={workspaceSectionPath(workspace.id, 'sources')}>All sources</Link>
            }
          >
            <CollectionState
              pending={sources.isPending}
              error={sources.error}
              empty={recentSources.length === 0}
              label="sources"
            >
              <ul className={styles.recentList}>
                {recentSources.map((source) => (
                  <ListRow
                    key={source.id}
                    leading={
                      <SourceTypeTile sourceType={source.sourceType} size="default" />
                    }
                    title={
                      <Link
                        to={`${workspaceSectionPath(workspace.id, 'sources')}/${encodeURIComponent(source.id)}`}
                      >
                        {source.displayName}
                      </Link>
                    }
                    meta={
                      <>
                        <SourceTypeBadge sourceType={source.sourceType} /> · Updated{' '}
                        <UpdatedTime value={source.updatedAt} />
                      </>
                    }
                    trailing={<SourceStatusChip status={source.status} />}
                  />
                ))}
              </ul>
            </CollectionState>
          </Panel>
        </div>
        <div className={styles.aiActivity}>
          <Panel title="Recent AI activity">
            <CollectionState
              pending={conversations.isPending}
              error={conversations.error}
              empty={recentConversations.length === 0}
              label="AI conversations"
            >
              <ul className={styles.recentList}>
                {recentConversations.map((conversation) => (
                  <ListRow
                    key={conversation.id}
                    title={conversation.title}
                    meta={<UpdatedTime value={conversation.updatedAt} />}
                  />
                ))}
              </ul>
            </CollectionState>
          </Panel>
        </div>
      </div>
    </section>
  );
}
