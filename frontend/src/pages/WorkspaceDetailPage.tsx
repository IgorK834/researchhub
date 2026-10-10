import type { ReactElement } from 'react';
import {
  Link,
  Navigate,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import { AskAIPage } from './AskAIPage';
import { AnalysisList } from '../features/analysis/components/AnalysisList';

import { DocumentList } from '../features/documents/components/DocumentList';
import { SourceList } from '../features/sources/components/SourceList';
import { ExternalSources } from '../features/sources/components/ExternalSources';
import {
  useWorkspaceMembersQuery,
  useWorkspaceQuery,
} from '../features/workspaces/api/useWorkspaces';
import { AddMemberForm } from '../features/workspaces/components/AddMemberForm';
import { ArchiveWorkspaceButton } from '../features/workspaces/components/ArchiveWorkspaceButton';
import { EditWorkspaceForm } from '../features/workspaces/components/EditWorkspaceForm';
import { MemberList } from '../features/workspaces/components/MemberList';
import { RoleInformation } from '../features/workspaces/components/RoleInformation';
import { WorkspaceOverview } from './WorkspaceOverview';
import type { WorkspaceQuestion } from '../features/ai/api/questionApi';
import { Icon } from '../shared/components/icons';
import styles from '../features/workspaces/components/WorkspaceViews.module.css';
import { describeError, hasApiErrorCode } from '../shared/api';
import {
  legacyWorkspaceSection,
  workspaceSectionPath,
  type WorkspaceSection,
} from '../app/workspaceRoutes';
import { RoleBadge } from '../shared/components/identity';
import { workspaceCapabilities } from '../shared/utils/workspaceCapabilities';

/**
 * One workspace: its metadata, the caller's role in it, and the owner's controls.
 *
 * Renders inside the protected `/app` shell, so there is always a signed-in user by the time this mounts.
 */
export function WorkspaceDetailPage({
  section = 'overview',
}: {
  readonly section?: WorkspaceSection;
}): ReactElement {
  const { workspaceId } = useParams<{ workspaceId: string }>();

  const location = useLocation();
  // The route always supplies the parameter, so this is unreachable in the app. Handled anyway, and
  // handled before any data hook runs, so the id passed down below is a definite string.
  if (workspaceId === undefined) {
    return <WorkspaceNotFound />;
  }
  const legacy = legacyWorkspaceSection(location.search, location.hash);
  if (section === 'overview' && legacy !== 'overview')
    return (
      <Navigate
        replace
        to={`${workspaceSectionPath(workspaceId, legacy)}${location.search}${location.hash}`}
      />
    );
  const content = <WorkspaceDetail workspaceId={workspaceId} section={section} />;
  return content;
}

/**
 * What a caller sees when the server says `404`.
 *
 * Deliberately says nothing about whether the workspace exists. The server answers "no such workspace"
 * and "not yours" identically so that an id cannot be probed for existence, and a page that rendered a
 * more helpful message for one of the two cases would hand back exactly the information the backend just
 * withheld.
 */
function WorkspaceNotFound(): ReactElement {
  return (
    <section>
      <h1>Workspace not found</h1>
      <p>
        This workspace is not available. It may have been removed, or you may not have
        access.
      </p>
      <p>
        <Link to="/app/workspaces">Back to your workspaces</Link>
      </p>
    </section>
  );
}

function WorkspaceDetail({
  workspaceId,
  section,
}: {
  readonly workspaceId: string;
  readonly section: WorkspaceSection;
}): ReactElement {
  const { data: workspace, error, isPending } = useWorkspaceQuery(workspaceId);
  const { data: members } = useWorkspaceMembersQuery(
    workspaceId,
    workspace !== undefined && error === null,
  );
  const navigate = useNavigate();
  const location = useLocation();
  // "Analyze this data" on a dataset preview arrives here with the source (and sheet) already chosen.
  const [search] = useSearchParams();
  const analyzeSource = search.get('analyzeSource');

  if (isPending) {
    return (
      <section>
        <p role="status" aria-live="polite">
          Loading this workspace…
        </p>
      </section>
    );
  }

  if (error !== null) {
    if (hasApiErrorCode(error, 'RESOURCE_NOT_FOUND')) {
      return <WorkspaceNotFound />;
    }
    return (
      <section>
        <h1>Workspace</h1>
        <p role="alert">Could not load this workspace: {describeError(error)}</p>
      </section>
    );
  }

  const isArchived = workspace.archivedAt !== null;

  const { canManage, canEditContent, canViewSettings } = workspaceCapabilities(
    workspace.role,
    isArchived,
  );

  if (section === 'overview') return <WorkspaceOverview workspace={workspace} />;
  if (section === 'analyses')
    return (
      <AnalysisList
        key={workspace.id}
        workspaceId={workspace.id}
        canEdit={canEditContent}
      />
    );
  // Presentation routing only: the backend continues to enforce membership and workspace writes.
  if (section === 'settings' && !canViewSettings)
    return <Navigate replace to={workspaceSectionPath(workspace.id, 'overview')} />;
  const initialQuestion = (
    location.state as { workspaceQuestion?: WorkspaceQuestion } | null
  )?.workspaceQuestion;
  if (section === 'documents')
    return (
      <DocumentList
        workspaceId={workspace.id}
        canEdit={canEditContent}
        onCreated={(id) => {
          void navigate(`/app/workspaces/${workspace.id}/documents/${id}`);
        }}
      />
    );
  if (section === 'sources')
    return (
      <SourceList
        key={workspace.id}
        workspaceId={workspace.id}
        canEdit={canEditContent}
        archived={isArchived}
        uploaderNames={
          new Map(members?.map((member) => [member.userId, member.displayName]))
        }
      />
    );
  if (section === 'external-sources')
    return (
      <ExternalSources
        key={workspace.id}
        workspaceId={workspace.id}
        canEdit={canEditContent}
      />
    );
  if (section === 'ask')
    return (
      <AskAIPage
        workspaceId={workspace.id}
        initialQuestion={initialQuestion}
        canEdit={canEditContent}
        initialConversationId={search.get('conversation') ?? undefined}
        initialSourceId={search.get('askSource') ?? undefined}
        onInitialQuestionUsed={() => {
          void navigate(`${location.pathname}${location.search}${location.hash}`, {
            replace: true,
            state: null,
          });
        }}
        {...(analyzeSource === null
          ? {}
          : {
              focus: { sourceId: analyzeSource, sheetName: search.get('analyzeSheet') },
            })}
      />
    );
  const heading =
    section === 'members'
      ? 'Members'
      : section === 'settings'
        ? 'Settings'
        : workspace.name;

  return (
    <section
      className={
        section === 'members' || section === 'settings' ? styles.sectionPage : undefined
      }
    >
      <h1>{heading}</h1>

      <p className={styles.sectionMeta}>
        {heading === workspace.name ? 'Your role:' : workspace.name}{' '}
        <RoleBadge role={workspace.role} />
      </p>

      {isArchived ? (
        <p role="status">
          This workspace is archived. It no longer appears in your workspace list, and its
          content can no longer be changed. Nothing has been deleted.
        </p>
      ) : null}

      {workspace.description === null ? (
        <p>No description.</p>
      ) : (
        <p>{workspace.description}</p>
      )}

      {/* Every member sees who else is here. Only an owner of an active workspace gets the controls, and
          the server re-checks that on every request. */}
      {section === 'members' ? (
        <div className={styles.adminGrid}>
          <MemberList
            key={workspace.id}
            workspaceId={workspace.id}
            canManage={canManage}
          />
          <div className={styles.adminColumn}>
            {canManage ? (
              <AddMemberForm key={workspace.id} workspaceId={workspace.id} />
            ) : null}
            <RoleInformation />
          </div>
        </div>
      ) : null}

      {/* Owner-only, and only while the workspace is active. Both conditions are re-checked by the
          server, which answers 403 to a non-owner and 409 on an archived workspace. */}
      {section === 'settings' ? (
        <div className={styles.settingsGrid}>
          <nav className={styles.settingsNav} aria-label="Workspace settings sections">
            <Link to={workspaceSectionPath(workspace.id, 'settings')} aria-current="page">
              <Icon name="sliders" size={18} />
              General
            </Link>
            <Link to={workspaceSectionPath(workspace.id, 'members')}>
              <Icon name="users" size={18} />
              Members
            </Link>
          </nav>
          <div className={styles.adminColumn}>
            <EditWorkspaceForm
              key={workspace.id}
              workspace={workspace}
              readOnly={!canManage}
            />
            {canManage ? (
              <ArchiveWorkspaceButton
                workspaceId={workspace.id}
                workspaceName={workspace.name}
              />
            ) : null}
          </div>
        </div>
      ) : null}
      <p>
        <Link to="/app/workspaces">Back to your workspaces</Link>
      </p>
    </section>
  );
}
