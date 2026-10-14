import { getIntlLocale } from '../shared/i18n';
import { t as uiText, useLocale as useUiLocale } from '../shared/i18n';
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
import { Illustration, type IllustrationScene } from '../shared/components/Illustration';
import { Banner, Skeleton } from '../shared/components/feedback';
import { AvatarStack, RoleBadge, Sticker } from '../shared/components/identity';
import styles from '../features/workspaces/components/WorkspaceViews.module.css';

function UpdatedTime({ value }: { readonly value: string }): ReactElement {
  return (
    <time dateTime={value}>
      {new Intl.DateTimeFormat(getIntlLocale(), {
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
  scene,
  children,
}: {
  readonly pending: boolean;
  readonly error: Error | null;
  readonly empty: boolean;
  readonly label: string;
  readonly scene: IllustrationScene;
  readonly children: ReactNode;
}): ReactElement {
  useUiLocale();
  if (pending)
    return (
      <>
        <p role="status">
          {uiText('ui.WorkspaceOverview.message001')} {label}…
        </p>
        <Skeleton height={64} shape="block" />
      </>
    );
  if (error !== null)
    return (
      <Banner
        tone="error"
        lead={uiText('ui.WorkspaceOverview.message011', { value0: label })}
      >
        {describeError(error)}
      </Banner>
    );
  if (empty)
    return (
      <div className={styles.collectionEmpty}>
        <Illustration scene={scene} size="compact" />
        <p className={styles.quiet}>
          {uiText('ui.WorkspaceOverview.message002')} {label}{' '}
          {uiText('ui.WorkspaceOverview.message003')}
        </p>
      </div>
    );
  return <>{children}</>;
}

/** Route-level composition: existing collections only, with no per-row reads or fabricated metadata. */
export function WorkspaceOverview({
  workspace,
}: {
  readonly workspace: Workspace;
}): ReactElement {
  useUiLocale();
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
        <div className={styles.heroContent}>
          <RoleBadge role={workspace.role} />
          <h1 id="workspace-overview-heading">{workspace.name}</h1>
          <p className={styles.heroDescription}>
            {workspace.description ?? uiText('ui.EditWorkspaceForm.message004')}
          </p>
          <div className={styles.heroMeta}>
            {members.error === null && members.data !== undefined ? (
              <AvatarStack
                label={uiText('ui.MemberList.message001')}
                people={members.data.map((member) => ({
                  userId: member.userId,
                  name: member.displayName,
                }))}
              />
            ) : null}
            {sources.error === null && readyCount !== undefined ? (
              <Sticker
                icon="sparkle"
                label={uiText('counts.grounded', { count: readyCount })}
              />
            ) : null}
          </div>
          {members.error !== null ? (
            <Banner tone="error" lead={uiText('ui.WorkspaceOverview.message012')}>
              {describeError(members.error)}
            </Banner>
          ) : null}
        </div>
        <div className={styles.heroArt}>
          <Illustration scene="hero" />
        </div>
      </header>
      {workspace.archivedAt !== null ? (
        <Banner lead={uiText('ui.WorkspaceOverview.message013')}>
          {uiText('ui.WorkspaceOverview.message004')}
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
            title={uiText('ui.WorkspaceOverview.message005')}
            header={
              <Link to={workspaceSectionPath(workspace.id, 'documents')}>
                {uiText('ui.WorkspaceOverview.message006')}
              </Link>
            }
          >
            <CollectionState
              pending={documents.isPending}
              error={documents.error}
              empty={recentDocuments.length === 0}
              label={uiText('ui.DocumentList.message003')}
              scene="documents"
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
                        {uiText('ui.DocumentList.message019')}
                        <UpdatedTime value={document.updatedAt} /> · v{document.revision}
                      </>
                    }
                  />
                ))}
              </ul>
            </CollectionState>
          </Panel>
          <Panel
            title={uiText('ui.WorkspaceOverview.message007')}
            header={
              <Link to={workspaceSectionPath(workspace.id, 'sources')}>
                {uiText('ui.SourceList.message033')}
              </Link>
            }
          >
            <CollectionState
              pending={sources.isPending}
              error={sources.error}
              empty={recentSources.length === 0}
              label={uiText('ui.AiDraftBlock.message004')}
              scene="sources"
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
                        <SourceTypeBadge sourceType={source.sourceType} />{' '}
                        {uiText('ui.WorkspaceOverview.message008')}{' '}
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
          <Panel title={uiText('ui.WorkspaceOverview.message009')}>
            <CollectionState
              pending={conversations.isPending}
              error={conversations.error}
              empty={recentConversations.length === 0}
              label={uiText('ui.WorkspaceOverview.message010')}
              scene="thinking"
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
