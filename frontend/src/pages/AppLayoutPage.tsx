import { t as uiText, useLocale as useUiLocale } from '../shared/i18n';
import { useEffect, useState, type ReactElement } from 'react';
import { Link, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';

import { useCurrentUser } from '../features/auth/api/useAuth';
import type { AuthenticatedUser } from '../features/auth/api/authApi';
import { LogoutButton } from '../features/auth/components/LogoutButton';
import { LanguageSwitcher } from '../shared/i18n';
import { useDocumentsQuery } from '../features/documents/api/useDocuments';
import { useSourcesQuery } from '../features/sources/api/useSources';
import { WorkspaceCommandSearch } from '../features/search/components/WorkspaceCommandSearch';
import { useAnalysesQuery } from '../features/analysis/api/useAnalyses';
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
  workspaceSectionLabel,
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
  readonly analyses?: number;
  readonly readySources?: number;
  readonly documentTitle?: string;
  readonly sourceTitle?: string;
  readonly sourceTitles?: ReadonlyMap<string, string>;
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
  const analyses = useAnalysesQuery(workspaceId ?? '', authorized);
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
        analyses:
          analyses.error === null && analyses.data && analyses.data.length < 50
            ? analyses.data.length
            : undefined,
        readySources: sourceData?.filter((source) => source.status === 'READY').length,
        documentTitle: documentData?.find((document) => document.id === documentId)
          ?.title,
        sourceTitle: sourceData?.find((source) => source.id === sourceId)?.displayName,
        sourceTitles: new Map(
          sourceData?.map((source) => [
            source.id,
            source.bibliography?.title ?? source.displayName,
          ]),
        ),
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
  readonly tone?: 'blue' | 'coral' | 'lavender' | 'yellow' | 'mint';
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
  useUiLocale();
  const navigate = useNavigate();
  if (workspaces?.length === 0 && context === undefined)
    return <DashedNote>{uiText('ui.AppLayoutPage.message001')}</DashedNote>;
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
          aria-label={uiText('ui.landingContent.message001')}
          value={current?.id ?? ''}
          disabled={options.length === 0}
          onChange={(event) => {
            void navigate(`/app/workspaces/${event.target.value}`);
          }}
        >
          <option value="" disabled>
            {unavailable
              ? uiText('ui.AppLayoutPage.message002')
              : workspaces === undefined
                ? uiText('ui.AppLayoutPage.message003')
                : uiText('ui.AppLayoutPage.message004')}
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
              : ` · ${uiText('counts.members', { count: context.members.length })}`}
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
  useUiLocale();
  const workspaces = useWorkspacesQuery();
  const location = useLocation();
  const navigate = useNavigate();
  const { workspaceId, documentId, sourceId, analysisId } = useParams();
  useSectionFocus();
  const [documentTopbarHost] = useState(() => document.createElement('div'));
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
    sectionKey === 'ask' ||
    analysisId !== undefined;
  const {
    canManage,
    canEditContent: canEdit,
    canViewSettings,
  } = workspaceCapabilities(
    context?.workspace.role,
    context === undefined || context.workspace.archivedAt !== null,
  );
  const segments: BreadcrumbSegment[] =
    workspaceId === undefined
      ? [{ label: location.pathname === '/app' ? 'Home' : 'Workspaces' }]
      : context === undefined
        ? [
            {
              get label() {
                return uiText('ui.AppLayoutPage.message006');
              },
              href: '/app/workspaces',
            },
            {
              get label() {
                return uiText('ui.landingContent.message001');
              },
            },
          ]
        : [
            { label: context.workspace.name, href: base },
            {
              label: workspaceSectionLabel(
                sectionKey in WORKSPACE_SECTIONS
                  ? (sectionKey as WorkspaceSection)
                  : 'overview',
              ),
              href: sectionHref,
            },
            ...(documentId
              ? [{ label: context.documentTitle ?? 'Document' }]
              : sourceId
                ? [{ label: context.sourceTitle ?? 'Source' }]
                : analysisId
                  ? [
                      {
                        label:
                          analysisId === 'new'
                            ? uiText('ui.AnalysisList.message003')
                            : 'Analysis',
                      },
                    ]
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
        {uiText('ui.AppLayoutPage.message007')}
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
        {uiText('ui.AddMemberForm.message006')}
      </Button>
    );
  else if (canEdit && section === 'Sources' && sourceId !== undefined)
    action = (
      <Button
        icon="upload"
        onClick={() => {
          void navigate(`${base}/sources#upload-source-heading`);
        }}
      >
        {uiText('ui.SourceList.message015')}
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
        {uiText('ui.DocumentList.message004')}
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
      members={documentId === undefined ? context?.members : undefined}
      primaryAction={
        documentId === undefined ? (
          action
        ) : (
          <div
            ref={(element) => {
              if (element && documentTopbarHost.parentNode !== element)
                element.appendChild(documentTopbarHost);
            }}
          />
        )
      }
      sidebar={
        <ShellSidebar
          brand={
            <Link to="/app" aria-label={uiText('ui.LandingHeader.message004')}>
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
                  {uiText('ui.AppLayoutPage.message008')}{' '}
                  <button
                    type="button"
                    onClick={() => {
                      void workspaces.refetch();
                    }}
                  >
                    {uiText('ui.CanvasContextPreview.message004')}
                  </button>
                </p>
              ) : null}
            </>
          }
          navigation={
            <nav
              aria-label={uiText('ui.AppLayoutPage.message009')}
              className={styles.navigation}
            >
              <WorkspaceCommandSearch
                key={context?.workspace.id ?? 'no-workspace'}
                workspaceId={context?.workspace.id}
                compact={narrow || tool}
              />
              <NavEntry
                href="/app"
                label={uiText('ui.AppLayoutPage.message010')}
                icon="home"
                selected={location.pathname === '/app'}
              />
              <NavEntry
                href="/app/workspaces"
                label={uiText('ui.AppLayoutPage.message006')}
                icon="library"
                selected={location.pathname === '/app/workspaces'}
              />
              <Button
                variant="ghost"
                icon="plus"
                className={styles.createWorkspace}
                aria-label={uiText('ui.CreateWorkspaceDialog.message001')}
                title={uiText('ui.CreateWorkspaceDialog.message001')}
                onClick={(event) => openCreateWorkspace(event.currentTarget)}
              >
                <span className={styles.navLabel}>
                  {uiText('ui.CreateWorkspaceDialog.message001')}
                </span>
              </Button>
              {context ? (
                <>
                  <p className={styles.groupLabel}>
                    {uiText('ui.landingContent.message001')}
                  </p>
                  <NavEntry
                    href={base}
                    label={uiText('ui.AppLayoutPage.message011')}
                    icon="grid"
                    tone="yellow"
                    selected={section === 'Overview'}
                  />
                  <NavEntry
                    href={`${base}/documents#workspace-documents-heading`}
                    label={uiText('ui.DocumentList.message001')}
                    icon="file"
                    tone="coral"
                    count={context.documents}
                    selected={section === 'Documents'}
                  />
                  <NavEntry
                    href={`${base}/sources#workspace-sources-heading`}
                    label={uiText('ui.landingContent.message005')}
                    icon="book"
                    count={context.sources}
                    selected={section === 'Sources'}
                  />
                  <NavEntry
                    href={`${base}/ask#workspace-questions-heading`}
                    label={uiText('ui.ResearchPanel.message007')}
                    icon="sparkle"
                    tone="lavender"
                    selected={section === 'Ask AI'}
                  />
                  <NavEntry
                    href={`${base}/analyses#workspace-analyses-heading`}
                    label={uiText('ui.AnalysisList.message001')}
                    icon="lineChart"
                    tone="mint"
                    count={context.analyses}
                    selected={section === 'Analyses'}
                  />
                  <NavEntry
                    href={`${base}/members#workspace-members-heading`}
                    label={uiText('ui.MemberList.message003')}
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
                label={uiText('counts.grounded', { count: context.readySources })}
              />
            )
          }
          footer={
            canViewSettings ? (
              <nav aria-label={uiText('ui.AppLayoutPage.message013')}>
                <NavEntry
                  href={`${base}/settings#edit-workspace-heading`}
                  label={uiText('ui.AppLayoutPage.message014')}
                  icon="sliders"
                  tone="lavender"
                  selected={section === 'Settings'}
                />
              </nav>
            ) : undefined
          }
          user={user}
          signOut={
            <>
              <Button
                href="/app/account"
                variant="ghost"
                size="compact"
                icon="sliders"
                aria-label={uiText('ui.AccountLink.message017')}
              >
                <span data-rh-label="">{uiText('ui.AccountLink.message017')}</span>
              </Button>
              <LogoutButton />
              <LanguageSwitcher />
            </>
          }
        />
      }
    >
      <Outlet context={{ user, documentTopbarHost } satisfies AppOutletContext} />
    </AppShell>
  );
}
