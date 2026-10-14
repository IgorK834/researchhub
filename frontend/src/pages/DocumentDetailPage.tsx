import { t as uiText, useLocale as useUiLocale } from '../shared/i18n';
import { useEffect, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import {
  Link,
  useNavigate,
  useOutletContext,
  useParams,
  useLocation,
} from 'react-router-dom';

import type { AppOutletContext } from '../app/AppOutletContext';
import { ResearchPanel } from '../features/ai/components/ResearchPanel';
import { AuthoringPanel } from '../features/ai/components/AuthoringPanel';
import { citationPath } from '../features/ai/api/generationApi';
import { useSourcesQuery } from '../features/sources/api/useSources';
import { useDocumentQuery } from '../features/documents/api/useDocuments';
import type { DocumentNavigation } from '../features/documents/api/documentNavigation';
import type { WorkspaceDocument } from '../features/documents/api/documentApi';
import { DocumentEditorForm } from '../features/documents/components/DocumentEditorForm';
import { DocumentList } from '../features/documents/components/DocumentList';
import {
  DocumentOutline,
  ContentOriginLegend,
} from '../features/documents/components/DocumentOutline';
import { DocumentSources } from '../features/documents/components/DocumentSources';
import {
  useWorkspaceQuery,
  useWorkspaceMembersQuery,
} from '../features/workspaces/api/useWorkspaces';
import { describeError, hasApiErrorCode } from '../shared/api';
import { Button } from '../shared/components/Button';
import { Breadcrumb, Tabs } from '../shared/components/navigation';
import { ToolShell } from '../shared/components/shell';
import { workspaceCapabilities } from '../shared/utils/workspaceCapabilities';
import styles from '../features/documents/components/DocumentFrame.module.css';

export function DocumentDetailPage(): ReactElement {
  const { workspaceId, documentId } = useParams<{
    workspaceId: string;
    documentId: string;
  }>();
  if (workspaceId === undefined || documentId === undefined)
    return <DocumentNotFound workspaceId={workspaceId} />;
  return (
    <DocumentScreen
      key={`${workspaceId}/${documentId}`}
      workspaceId={workspaceId}
      documentId={documentId}
    />
  );
}

function DocumentNotFound({
  workspaceId,
}: {
  readonly workspaceId: string | undefined;
}): ReactElement {
  useUiLocale();
  return (
    <section>
      <h1>{uiText('ui.DocumentDetailPage.message001')}</h1>
      <p>{uiText('ui.DocumentDetailPage.message002')}</p>
      <Link
        to={
          workspaceId === undefined ? '/app/workspaces' : `/app/workspaces/${workspaceId}`
        }
      >
        {uiText('ui.DocumentDetailPage.message003')}
      </Link>
    </section>
  );
}

type ContextTab =
  'sources' | 'research' | 'writing' | 'history' | 'comments' | 'provenance';
const EMPTY_NAVIGATION: DocumentNavigation = {
  headings: [],
  references: [],
  activePosition: null,
};

/** Pages compose workspace permissions, document state and AI; feature components own their UI. */
function DocumentScreen({
  workspaceId,
  documentId,
}: {
  readonly workspaceId: string;
  readonly documentId: string;
}): ReactElement {
  useUiLocale();
  const document = useDocumentQuery(workspaceId, documentId);
  const workspace = useWorkspaceQuery(workspaceId);
  const authorized = workspace.data !== undefined && workspace.error === null;
  const sources = useSourcesQuery(workspaceId, authorized);
  const members = useWorkspaceMembersQuery(workspaceId, authorized);
  const navigate = useNavigate();
  const outlet = useOutletContext<AppOutletContext | null>();
  const [reloadCount, setReloadCount] = useState(0);
  const location = useLocation();
  const [focusBlock, setFocusBlock] = useState<number | undefined>(() =>
    typeof location.state?.focusBlock === 'number'
      ? (location.state.focusBlock as number)
      : undefined,
  );
  const [navigation, setNavigation] = useState(EMPTY_NAVIGATION);
  const [navigationTarget, setNavigationTarget] = useState<{ position: number } | null>(
    null,
  );
  const [tab, setTab] = useState<ContextTab>(
    location.hash.startsWith('#comment-') ? 'comments' : 'sources',
  );
  const [contextOpen, setContextOpen] = useState(location.hash.startsWith('#comment-'));
  const [commentNavigation, setCommentNavigation] = useState(location.key);
  if (commentNavigation !== location.key) {
    setCommentNavigation(location.key);
    if (location.hash.startsWith('#comment-')) {
      setTab('comments');
      setContextOpen(true);
    }
  }
  const [historyHost] = useState(() => window.document.createElement('div'));
  const [provenanceHost] = useState(() => window.document.createElement('div'));
  const [commentsHost] = useState(() => window.document.createElement('div'));
  const [authoringHost] = useState(() => window.document.createElement('div'));
  const [presenceHost] = useState(() => window.document.createElement('div'));
  const [statusHost] = useState(() => window.document.createElement('div'));
  const [exportHost] = useState(() => window.document.createElement('div'));
  const attach =
    (host: HTMLElement) =>
    (element: HTMLDivElement | null): void => {
      if (element && host.parentNode !== element) element.appendChild(host);
    };
  if (document.error !== null && hasApiErrorCode(document.error, 'RESOURCE_NOT_FOUND'))
    return <DocumentNotFound workspaceId={workspaceId} />;

  const { canEditContent: canEdit } = workspaceCapabilities(
    workspace.data?.role,
    workspace.data === undefined || workspace.data.archivedAt !== null,
  );
  const authoringAvailable = canEdit && document.data?.archivedAt === null;
  const showContext = (value: ContextTab): void => {
    setTab(value);
    setContextOpen(true);
  };
  const sourceError =
    sources.error === null
      ? null
      : `Could not load research sources: ${describeError(sources.error)}`;
  const topbar = (
    <div className={styles.topbar}>
      {outlet?.documentTopbarHost === undefined ? (
        <Breadcrumb
          segments={[
            {
              label: workspace.data?.name ?? 'Workspace',
              href: `/app/workspaces/${workspaceId}`,
            },
            {
              get label() {
                return uiText('ui.DocumentList.message001');
              },
              href: `/app/workspaces/${workspaceId}/documents`,
            },
            { label: document.data?.title ?? 'Document' },
          ]}
          renderLink={(segment) => <Link to={segment.href}>{segment.label}</Link>}
        />
      ) : null}
      <div className={styles.topbarActions}>
        <div ref={attach(statusHost)} />
        <div ref={attach(presenceHost)} />
        <div ref={attach(exportHost)} />
        <Button
          variant="secondary"
          icon="comment"
          onClick={() => showContext('comments')}
        >
          {uiText('ui.DocumentComments.message002')}
        </Button>
        <Button variant="secondary" icon="history" onClick={() => showContext('history')}>
          {uiText('ui.DocumentDetailPage.message004')}
        </Button>
        <Button icon="sparkle" onClick={() => showContext('research')}>
          {uiText('ui.ResearchPanel.message007')}
        </Button>
      </div>
    </div>
  );

  return (
    <>
      {outlet?.documentTopbarHost === undefined
        ? topbar
        : createPortal(topbar, outlet.documentTopbarHost)}
      <ToolShell
        label={uiText('ui.AddMemberForm.message003')}
        secondaryLabel={uiText('ui.DocumentList.message018')}
        secondaryWidth={240}
        contextOpen={contextOpen}
        onContextOpenChange={setContextOpen}
        secondary={
          <div className={styles.column}>
            <Link className={styles.back} to={`/app/workspaces/${workspaceId}/documents`}>
              {uiText('ui.DocumentDetailPage.message003')}
            </Link>
            <DocumentList
              workspaceId={workspaceId}
              currentDocumentId={documentId}
              canEdit={canEdit}
              variant="column"
              onCreated={(id) => {
                void navigate(`/app/workspaces/${workspaceId}/documents/${id}`);
              }}
            />
            <DocumentOutline
              navigation={navigation}
              onNavigate={(position) => setNavigationTarget({ position })}
            />
            <ContentOriginLegend />
          </div>
        }
        contextTitle={uiText('ui.DocumentDetailPage.message008')}
        context={
          document.data !== undefined && authorized ? (
            <div className={styles.contextTabs}>
              <Tabs<ContextTab>
                label={uiText('ui.CanvasAiChat.message002')}
                value={tab}
                onChange={setTab}
                items={[
                  {
                    value: 'sources',
                    get label() {
                      return uiText('ui.landingContent.message005');
                    },
                    content: (
                      <DocumentSources
                        workspaceId={workspaceId}
                        analyses={navigation.analyses}
                        references={navigation.references}
                        citationHref={(citation) =>
                          citationPath({ ...citation, chunkId: citation.chunkId ?? '' })
                        }
                        sources={
                          sources.data?.map((source) => ({
                            id: source.id,
                            title: source.displayName,
                            sourceType: source.sourceType,
                            href: `/app/workspaces/${workspaceId}/sources/${source.id}`,
                          })) ?? []
                        }
                        loading={sources.isPending}
                        error={sourceError}
                      />
                    ),
                  },
                  {
                    value: 'research',
                    get label() {
                      return uiText('ui.ResearchPanel.message007');
                    },
                    content: (
                      <ResearchPanel
                        workspaceId={workspaceId}
                        sources={{
                          sources:
                            sources.data?.map((source) => ({
                              id: source.id,
                              title: source.displayName,
                              sourceType: source.sourceType,
                              ready: source.status === 'READY',
                              status: source.status,
                            })) ?? [],
                          loading: sources.isPending,
                          error: sourceError,
                        }}
                      />
                    ),
                  },
                  ...(authoringAvailable
                    ? [
                        {
                          value: 'writing' as const,
                          get label() {
                            return uiText('ui.landingContent.message012');
                          },
                          content: <div ref={attach(authoringHost)} />,
                        },
                      ]
                    : []),
                  {
                    value: 'comments',
                    get label() {
                      return uiText('ui.DocumentComments.message002');
                    },
                    content: <div ref={attach(commentsHost)} />,
                  },
                  {
                    value: 'provenance',
                    get label() {
                      return uiText('ui.DocumentProvenance.message002');
                    },
                    content: <div ref={attach(provenanceHost)} />,
                  },
                  {
                    value: 'history',
                    get label() {
                      return uiText('ui.DocumentDetailPage.message004');
                    },
                    content: <div ref={attach(historyHost)} />,
                  },
                ]}
              />
            </div>
          ) : undefined
        }
      >
        <EditorArea
          exportHost={exportHost}
          workspaceId={workspaceId}
          document={document}
          sourceTypes={
            new Map(sources.data?.map((source) => [source.id, source.sourceType]))
          }
          canEdit={canEdit}
          contextCaptureEnabled={workspace.data?.archivedAt === null}
          isViewer={authorized && workspace.data?.role === 'VIEWER'}
          authors={
            members.error === null
              ? (members.data?.map((member) => ({
                  userId: member.userId,
                  name: member.displayName,
                })) ?? [])
              : []
          }
          reloadCount={reloadCount}
          onReload={() => setReloadCount((count) => count + 1)}
          onAccepted={(_document, block) => {
            setFocusBlock(block);
            setReloadCount((count) => count + 1);
          }}
          focusBlock={focusBlock}
          onOpenAuthoring={() => showContext('writing')}
          navigationTarget={navigationTarget}
          onNavigationChange={setNavigation}
          presenceHost={presenceHost}
          statusHost={statusHost}
          historyHost={historyHost}
          commentsHost={commentsHost}
          provenanceHost={provenanceHost}
          onOpenComments={() => showContext('comments')}
          historyExpanded={tab === 'history'}
          authoringHost={authoringHost}
        />
      </ToolShell>
    </>
  );
}

function EditorArea({
  contextCaptureEnabled,
  exportHost,
  commentsHost,
  provenanceHost,
  onOpenComments,
  workspaceId,
  document,
  canEdit,
  isViewer,
  authors,
  reloadCount,
  onReload,
  navigationTarget,
  onNavigationChange,
  statusHost,
  presenceHost,
  historyHost,
  historyExpanded,
  authoringHost,
  sourceTypes,
  onAccepted,
  focusBlock,
  onOpenAuthoring,
}: {
  readonly exportHost: HTMLElement;
  readonly commentsHost: HTMLElement;
  readonly provenanceHost: HTMLElement;
  readonly onOpenComments: () => void;
  readonly workspaceId: string;
  readonly document: ReturnType<typeof useDocumentQuery>;
  readonly contextCaptureEnabled: boolean;
  readonly canEdit: boolean;
  readonly isViewer: boolean;
  readonly authors: readonly { readonly userId: string; readonly name: string }[];
  readonly reloadCount: number;
  readonly onReload: () => void;
  readonly navigationTarget: { readonly position: number } | null;
  readonly onNavigationChange: (navigation: DocumentNavigation) => void;
  readonly presenceHost: HTMLElement;
  readonly statusHost: HTMLElement;
  readonly historyHost: HTMLElement;
  readonly historyExpanded: boolean;
  readonly authoringHost: HTMLElement;
  readonly sourceTypes: ReadonlyMap<string, string>;
  readonly onAccepted: (document: WorkspaceDocument, focusBlock?: number) => void;
  readonly focusBlock: number | undefined;
  readonly onOpenAuthoring: () => void;
}): ReactElement {
  useUiLocale();
  if (document.isPending)
    return (
      <p role="status" aria-live="polite">
        {uiText('ui.DocumentDetailPage.message005')}
      </p>
    );
  if (document.error !== null)
    return (
      <>
        <h1>{uiText('ui.InsertAnalysisResult.message004')}</h1>
        <p role="alert">
          {uiText('ui.DocumentDetailPage.message006')} {describeError(document.error)}
        </p>
      </>
    );
  return (
    <>
      <h1 className="visually-hidden">{document.data.title}</h1>
      {document.data.archivedAt !== null ? (
        <p role="status">{uiText('ui.DocumentDetailPage.message007')}</p>
      ) : null}
      <DocumentEditorForm
        exportHost={exportHost}
        commentsHost={commentsHost}
        provenanceHost={provenanceHost}
        onOpenComments={onOpenComments}
        key={`${document.data.id}-${reloadCount}`}
        workspaceId={workspaceId}
        document={document.data}
        canEdit={canEdit}
        contextCaptureEnabled={contextCaptureEnabled}
        isViewer={isViewer}
        authors={authors}
        sourceTypes={sourceTypes}
        onDiscardLocalChanges={() => {
          void document.refetch().then(onReload);
        }}
        onReplaced={onAccepted}
        focusBlock={focusBlock}
        onOpenAuthoring={onOpenAuthoring}
        navigationTarget={navigationTarget}
        onNavigationChange={onNavigationChange}
        presenceHost={presenceHost}
        statusHost={statusHost}
        historyHost={historyHost}
        historyExpanded={historyExpanded}
        renderAuthoring={(context) =>
          createPortal(<AuthoringPanel {...context} />, authoringHost)
        }
      />
    </>
  );
}
