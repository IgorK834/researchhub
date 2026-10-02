import { useEffect, type ReactElement } from 'react';
import { Link, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';

import { useCurrentUser } from '../features/auth/api/useAuth';
import type { AuthenticatedUser } from '../features/auth/api/authApi';
import { LogoutButton } from '../features/auth/components/LogoutButton';
import { useDocumentsQuery } from '../features/documents/api/useDocuments';
import { useSourcesQuery } from '../features/sources/api/useSources';
import {
  useWorkspaceMembersQuery,
  useWorkspaceQuery,
  useWorkspacesQuery,
} from '../features/workspaces/api/useWorkspaces';
import type { Workspace } from '../features/workspaces/api/workspaceApi';
import { Button } from '../shared/components/Button';
import { DashedNote, IconTile } from '../shared/components/content';
import { Sticker, type AvatarPerson } from '../shared/components/identity';
import { Icon, type IconName } from '../shared/components/icons';
import { Breadcrumb, type BreadcrumbSegment } from '../shared/components/navigation';
import { AppShell, ResearchHubMark, ShellSidebar } from '../shared/components/shell';
import styles from '../app/AppNavigation.module.css';
import {
  WORKSPACE_SECTIONS,
  workspaceSectionPath,
  type WorkspaceSection,
} from '../app/workspaceRoutes';
import { useNarrowDesktop } from '../shared/hooks/useNarrowDesktop';
import {
  workspaceCapabilities,
  workspaceRoleLabel,
} from '../shared/utils/workspaceCapabilities';
import {
  CreateWorkspaceDialogProvider,
  useCreateWorkspaceDialog,
} from '../features/workspaces/components/CreateWorkspaceDialog';
import type { AppOutletContext } from '../app/AppOutletContext';

interface WorkspaceNavigation {
  readonly workspace: Workspace;
  readonly members?: readonly AvatarPerson[];
  readonly documents?: number;
  readonly sources?: number;
  readonly readySources?: number;
  readonly documentTitle?: string;
  readonly sourceTitle?: string;
}

/** The guard resolves the session. Workspace context follows the URL, never a stored preference. */
export function AppLayoutPage(): ReactElement | null {
  const { data: user } = useCurrentUser();
  const { workspaceId, documentId, sourceId } = useParams();
  const workspace = useWorkspaceQuery(workspaceId ?? '', workspaceId !== undefined);
  const authorized =
    workspaceId !== undefined && workspace.data !== undefined && workspace.error === null;
  const members = useWorkspaceMembersQuery(workspaceId ?? '', authorized);
  const documents = useDocumentsQuery(workspaceId ?? '', authorized);
  const sources = useSourcesQuery(workspaceId ?? '', authorized);
  const documentData = documents.error === null ? documents.data : undefined;
  const sourceData = sources.error === null ? sources.data : undefined;
  if (!user) return null;
  const context: WorkspaceNavigation | undefined = authorized
    ? {
        workspace: workspace.data!,
        members:
          members.error === null
            ? members.data?.map((member) => ({
                userId: member.userId,
                name: member.displayName,
              }))
            : undefined,
        documents: documentData?.length,
        sources: sourceData?.length,
        readySources: sourceData?.filter((source) => source.status === 'READY').length,
        documentTitle: documentData?.find((document) => document.id === documentId)
          ?.title,
        sourceTitle: sourceData?.find((source) => source.id === sourceId)?.displayName,
      }
    : undefined;
  // Keep this tree stable while queries resolve: remounting an Outlet would discard editor drafts.
  return (
    <CreateWorkspaceDialogProvider>
      <ShellContent user={user} context={context} />
    </CreateWorkspaceDialogProvider>
  );
}

/** Focus the actual existing section even when its data arrives after navigation. */
function useSectionFocus(): void {
  const location = useLocation();
  useEffect(() => {
    if (!location.hash) return;
    const focus = (): boolean => {
      const target = document.getElementById(location.hash.slice(1));
      if (!target) return false;
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      target.focus();
      target.scrollIntoView?.({ block: 'start' });
      return true;
    };
    if (focus()) return;
    const observer = new MutationObserver(() => {
      if (focus()) observer.disconnect();
    });
    observer.observe(document.getElementById('researchhub-main')!, {
      childList: true,
      subtree: true,
    });
    return () => observer.disconnect();
  }, [location.pathname, location.hash, location.key]);
}

interface NavEntryProps {
  readonly href: string;
  readonly label: string;
  readonly icon: IconName;
  readonly selected: boolean;
  readonly tone?: 'blue' | 'coral' | 'lavender' | 'yellow';
  readonly count?: number;
}
function NavEntry({
  href,
  label,
  icon,
  selected,
  tone = 'blue',
  count,
}: NavEntryProps): ReactElement {
  return (
    <Link
      to={href}
      aria-current={selected ? 'page' : undefined}
      aria-label={`${label}${count === undefined ? '' : ` ${count}`}`}
      title={label}
      className={styles.navEntry}
    >
      {selected ? (
        <IconTile icon={icon} tone={tone} size="small" fill="base" />
      ) : (
        <span className={styles.navIcon}>
          <Icon name={icon} size={18} />
        </span>
      )}
      <span className={styles.navLabel}>{label}</span>
      {count === undefined ? null : <span className={styles.count}>{count}</span>}
    </Link>
  );
}

function WorkspaceSwitcher({
  workspaces,
  context,
  unavailable,
}: {
  readonly unavailable: boolean;
  readonly workspaces: readonly Workspace[] | undefined;
  readonly context: WorkspaceNavigation | undefined;
}): ReactElement {
  const navigate = useNavigate();
  if (workspaces?.length === 0 && context === undefined)
    return (
      <DashedNote>
        No workspace yet. Create one to see Documents, Sources and Ask AI here.
      </DashedNote>
    );
  const current = context?.workspace;
  const options =
    current && !workspaces?.some((workspace) => workspace.id === current.id)
      ? [current, ...(workspaces ?? [])]
      : (workspaces ?? []);
  return (
    <div className={styles.switcher}>
      <span aria-hidden="true" className={styles.workspaceLetter}>
        {current?.name.trim().slice(0, 1).toLocaleUpperCase() ?? <Icon name="library" />}
      </span>
      <div className={styles.switcherText}>
        <select
          aria-label="Workspace"
          value={current?.id ?? ''}
          disabled={options.length === 0}
          onChange={(event) => {
            void navigate(`/app/workspaces/${event.target.value}`);
          }}
        >
          <option value="" disabled>
            {unavailable
              ? 'Workspaces unavailable'
              : workspaces === undefined
                ? 'Loading workspaces…'
                : 'Choose a workspace'}
          </option>
          {options.map((workspace) => (
            <option key={workspace.id} value={workspace.id}>
              {workspace.name}
            </option>
          ))}
        </select>
        {current ? (
          <span className={styles.workspaceMeta}>
            {workspaceRoleLabel(current.role)}
            {context?.members === undefined
              ? ''
              : ` · ${context.members.length} ${context.members.length === 1 ? 'member' : 'members'}`}
          </span>
        ) : null}
      </div>
      <span aria-hidden="true" className={styles.switcherArrow}>
        <Icon name="sort" size={14} />
      </span>
    </div>
  );
}

function ShellContent({
  user,
  context,
}: {
  readonly user: AuthenticatedUser;
  readonly context?: WorkspaceNavigation;
}): ReactElement {
  const workspaces = useWorkspacesQuery();
  const location = useLocation();
  const navigate = useNavigate();
  const { workspaceId, documentId, sourceId } = useParams();
  useSectionFocus();
  const base = `/app/workspaces/${workspaceId}`;
  const narrow = useNarrowDesktop();
  const { openCreateWorkspace, defaultTriggerRef } = useCreateWorkspaceDialog();
  const sectionKey = location.pathname.slice(base.length).split('/')[1] ?? 'overview';
  const section = WORKSPACE_SECTIONS[sectionKey as WorkspaceSection] ?? 'Overview';
  const sectionHref = workspaceSectionPath(
    workspaceId ?? '',
    sectionKey in WORKSPACE_SECTIONS ? (sectionKey as WorkspaceSection) : 'overview',
  );
  const tool =
    documentId !== undefined ||
    (sourceId !== undefined && !narrow) ||
    sectionKey === 'ask';
  const { canManage, canEditContent: canEdit } = workspaceCapabilities(
    context?.workspace.role,
    context === undefined || context.workspace.archivedAt !== null,
  );
  const segments: BreadcrumbSegment[] =
    workspaceId === undefined
      ? [{ label: location.pathname === '/app' ? 'Home' : 'Workspaces' }]
      : context === undefined
        ? [{ label: 'Workspaces', href: '/app/workspaces' }, { label: 'Workspace' }]
        : [
            { label: context.workspace.name, href: base },
            {
              label: section,
              href: sectionHref,
            },
            ...(documentId
              ? [{ label: context.documentTitle ?? 'Document' }]
              : sourceId
                ? [{ label: context.sourceTitle ?? 'Source' }]
                : []),
          ];
  let action: ReactElement | undefined;
  if (workspaceId === undefined)
    action = (
      <Button
        icon="plus"
        ref={defaultTriggerRef}
        onClick={(event) => openCreateWorkspace(event.currentTarget)}
      >
        New workspace
      </Button>
    );
  else if (canManage && section === 'Members')
    action = (
      <Button
        icon="plus"
        onClick={() => {
          void navigate(`${base}/members#add-member-heading`);
        }}
      >
        Add member
      </Button>
    );
  else if (canEdit && section === 'Sources')
    action = (
      <Button
        icon="upload"
        onClick={() => {
          void navigate(`${base}/sources#upload-source-heading`);
        }}
      >
        Upload source
      </Button>
    );
  else if (canEdit && (section === 'Overview' || section === 'Documents'))
    action = (
      <Button
        icon="plus"
        onClick={() => {
          void navigate(`${base}/documents#create-document-heading`);
        }}
      >
        New document
      </Button>
    );

  return (
    <AppShell
      tool={tool}
      breadcrumb={
        <Breadcrumb
          segments={segments}
          renderLink={(segment) => (
            <Link to={segment.href} title={segment.label}>
              {segment.label}
            </Link>
          )}
        />
      }
      members={context?.members}
      primaryAction={action}
      sidebar={
        <ShellSidebar
          brand={
            <Link to="/app" aria-label="ResearchHub home">
              <ResearchHubMark />
              <span>ResearchHub</span>
            </Link>
          }
          switcher={
            <>
              <WorkspaceSwitcher
                workspaces={workspaces.error === null ? workspaces.data : undefined}
                context={context}
                unavailable={workspaces.error !== null}
              />
              {workspaces.error ? (
                <p className={styles.queryError} role="status">
                  Workspaces unavailable.{' '}
                  <button
                    type="button"
                    onClick={() => {
                      void workspaces.refetch();
                    }}
                  >
                    Retry
                  </button>
                </p>
              ) : null}
            </>
          }
          navigation={
            <nav aria-label="Application navigation" className={styles.navigation}>
              <NavEntry
                href="/app"
                label="Home"
                icon="home"
                selected={location.pathname === '/app'}
              />
              <NavEntry
                href="/app/workspaces"
                label="Workspaces"
                icon="library"
                selected={location.pathname === '/app/workspaces'}
              />
              <Button
                variant="ghost"
                icon="plus"
                className={styles.createWorkspace}
                aria-label="Create workspace"
                title="Create workspace"
                onClick={(event) => openCreateWorkspace(event.currentTarget)}
              >
                <span className={styles.navLabel}>Create workspace</span>
              </Button>
              {context ? (
                <>
                  <p className={styles.groupLabel}>Workspace</p>
                  <NavEntry
                    href={base}
                    label="Overview"
                    icon="grid"
                    tone="yellow"
                    selected={section === 'Overview'}
                  />
                  <NavEntry
                    href={`${base}/documents#workspace-documents-heading`}
                    label="Documents"
                    icon="file"
                    tone="coral"
                    count={context.documents}
                    selected={section === 'Documents'}
                  />
                  <NavEntry
                    href={`${base}/sources#workspace-sources-heading`}
                    label="Sources"
                    icon="book"
                    count={context.sources}
                    selected={section === 'Sources'}
                  />
                  <NavEntry
                    href={`${base}/ask#workspace-questions-heading`}
                    label="Ask AI"
                    icon="sparkle"
                    tone="lavender"
                    selected={section === 'Ask AI'}
                  />
                  <NavEntry
                    href={`${base}/members#workspace-members-heading`}
                    label="Members"
                    icon="users"
                    tone="yellow"
                    selected={section === 'Members'}
                  />
                </>
              ) : null}
            </nav>
          }
          sticker={
            context?.readySources === undefined ? undefined : (
              <Sticker
                icon="sparkle"
                label={`Grounded in ${context.readySources} ${context.readySources === 1 ? 'source' : 'sources'}`}
              />
            )
          }
          footer={
            canManage ? (
              <nav aria-label="Workspace settings">
                <NavEntry
                  href={`${base}/settings#edit-workspace-heading`}
                  label="Settings"
                  icon="sliders"
                  tone="lavender"
                  selected={section === 'Settings'}
                />
              </nav>
            ) : undefined
          }
          user={user}
          signOut={<LogoutButton />}
        />
      }
    >
      <Outlet context={{ user } satisfies AppOutletContext} />
    </AppShell>
  );
}
