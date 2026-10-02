import type { ReactElement } from 'react';
import {
  Link,
  Navigate,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import { SourceComparisonPanel } from '../features/ai/components/SourceComparisonPanel';
import { WorkspaceQuestions } from '../features/ai/components/WorkspaceQuestions';

import { CreateDocumentForm } from '../features/documents/components/CreateDocumentForm';
import { DocumentList } from '../features/documents/components/DocumentList';
import { SourceList } from '../features/sources/components/SourceList';
import { SourceUploadForm } from '../features/sources/components/SourceUploadForm';
import {
  useWorkspaceMembersQuery,
  useWorkspaceQuery,
} from '../features/workspaces/api/useWorkspaces';
import { AddMemberForm } from '../features/workspaces/components/AddMemberForm';
import { ArchiveWorkspaceButton } from '../features/workspaces/components/ArchiveWorkspaceButton';
import { EditWorkspaceForm } from '../features/workspaces/components/EditWorkspaceForm';
import { MemberList } from '../features/workspaces/components/MemberList';
import { describeError, hasApiErrorCode } from '../shared/api';
import {
  legacyWorkspaceSection,
  workspaceSectionPath,
  type WorkspaceSection,
} from '../app/workspaceRoutes';
import { ToolShell } from '../shared/components/shell';
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
  return section === 'ask' ? <ToolShell label="Ask AI">{content}</ToolShell> : content;
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

  const { canManage, canEditContent } = workspaceCapabilities(workspace.role, isArchived);

  return (
    <section>
      <h1>{workspace.name}</h1>

      <p>
        Your role: <RoleBadge role={workspace.role} />
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

      {/* Every member can read the documents; only an editor or owner can start one. */}
      {section === 'overview' || section === 'documents' ? (
        <DocumentList workspaceId={workspace.id} />
      ) : null}
      {section === 'documents' && canEditContent ? (
        <CreateDocumentForm
          workspaceId={workspace.id}
          onCreated={(created) => {
            // A new document is opened straight away: it was created to be written in.
            void navigate(`/app/workspaces/${workspace.id}/documents/${created.id}`);
          }}
        />
      ) : null}

      {section === 'overview' || section === 'sources' ? (
        <SourceList
          workspaceId={workspace.id}
          uploaderNames={
            new Map(members?.map((member) => [member.userId, member.displayName]))
          }
        />
      ) : null}
      {section === 'sources' && canEditContent ? (
        <SourceUploadForm workspaceId={workspace.id} />
      ) : null}
      {section === 'ask' ? (
        <>
          <WorkspaceQuestions
            workspaceId={workspace.id}
            {...(analyzeSource === null
              ? {}
              : {
                  focus: {
                    sourceId: analyzeSource,
                    sheetName: search.get('analyzeSheet'),
                  },
                })}
          />
          <SourceComparisonPanel workspaceId={workspace.id} />
        </>
      ) : null}

      {/* Every member sees who else is here. Only an owner of an active workspace gets the controls, and
          the server re-checks that on every request. */}
      {section === 'members' ? (
        <MemberList workspaceId={workspace.id} canManage={canManage} />
      ) : null}

      {/* Owner-only, and only while the workspace is active. Both conditions are re-checked by the
          server, which answers 403 to a non-owner and 409 on an archived workspace. */}
      {section === 'members' && canManage ? (
        <AddMemberForm workspaceId={workspace.id} />
      ) : null}
      {section === 'settings' && canManage ? (
        <>
          <EditWorkspaceForm workspace={workspace} />
          <ArchiveWorkspaceButton workspaceId={workspace.id} />
        </>
      ) : null}

      {section === 'settings' && !canManage ? (
        <p>
          Workspace settings are read-only. Only an owner of an active workspace can
          change them.
        </p>
      ) : null}
      <p>
        <Link to="/app/workspaces">Back to your workspaces</Link>
      </p>
    </section>
  );
}
