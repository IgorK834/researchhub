import { useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom';

import type { AppOutletContext } from '../app/AppOutletContext';
import { ResearchPanel } from '../features/ai/components/ResearchPanel';
import { AuthoringPanel } from '../features/ai/components/AuthoringPanel';
import { citationPath } from '../features/ai/api/generationApi';
import { useSourcesQuery } from '../features/sources/api/useSources';
import { useDocumentQuery } from '../features/documents/api/useDocuments';
import type { DocumentNavigation } from '../features/documents/api/documentNavigation';
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
import { AvatarStack } from '../shared/components/identity';
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
  return (
    <section>
      <h1>Document not found</h1>
      <p>
        This document is not available. It may have been removed, or you may not have
        access.
      </p>
      <Link
        to={
          workspaceId === undefined ? '/app/workspaces' : `/app/workspaces/${workspaceId}`
        }
      >
        Back to the workspace
      </Link>
    </section>
  );
}

type ContextTab = 'sources' | 'research' | 'writing' | 'history';
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
  const document = useDocumentQuery(workspaceId, documentId);
  const workspace = useWorkspaceQuery(workspaceId);
  const authorized = workspace.data !== undefined && workspace.error === null;
  const sources = useSourcesQuery(workspaceId, authorized);
  const members = useWorkspaceMembersQuery(workspaceId, authorized);
  const navigate = useNavigate();
  const outlet = useOutletContext<AppOutletContext | null>();
  const [reloadCount, setReloadCount] = useState(0);
  const [navigation, setNavigation] = useState(EMPTY_NAVIGATION);
  const [navigationTarget, setNavigationTarget] = useState<{ position: number } | null>(
    null,
  );
  const [tab, setTab] = useState<ContextTab>('sources');
  const [contextOpen, setContextOpen] = useState(false);
  const [historyHost] = useState(() => window.document.createElement('div'));
  const [authoringHost] = useState(() => window.document.createElement('div'));
  const [statusHost] = useState(() => window.document.createElement('div'));
  const attach =
    (host: HTMLElement) =>
    (element: HTMLDivElement | null): void => {
      if (element) element.appendChild(host);
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
            { label: 'Documents', href: `/app/workspaces/${workspaceId}/documents` },
            { label: document.data?.title ?? 'Document' },
          ]}
          renderLink={(segment) => <Link to={segment.href}>{segment.label}</Link>}
        />
      ) : null}
      <div className={styles.topbarActions}>
        <div ref={attach(statusHost)} />
        {outlet?.documentTopbarHost === undefined &&
        members.data !== undefined &&
        members.error === null ? (
          <AvatarStack
            people={members.data.map((member) => ({
              userId: member.userId,
              name: member.displayName,
            }))}
            label="Workspace members"
          />
        ) : null}
        <Button variant="secondary" icon="history" onClick={() => showContext('history')}>
          History
        </Button>
        <Button icon="sparkle" onClick={() => showContext('research')}>
          Ask AI
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
        label="Editor"
        secondaryLabel="Workspace documents"
        secondaryWidth={240}
        contextOpen={contextOpen}
        onContextOpenChange={setContextOpen}
        secondary={
          <div className={styles.column}>
            <Link className={styles.back} to={`/app/workspaces/${workspaceId}/documents`}>
              Back to the workspace
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
        contextTitle="Research alongside the document"
        context={
          document.data !== undefined && authorized ? (
            <Tabs<ContextTab>
              label="Document context"
              value={tab}
              onChange={setTab}
              items={[
                {
                  value: 'sources',
                  label: 'Sources',
                  content: (
                    <DocumentSources
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
                  label: 'Ask AI',
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
                        label: 'Writing',
                        content: <div ref={attach(authoringHost)} />,
                      },
                    ]
                  : []),
                {
                  value: 'history',
                  label: 'History',
                  content: <div ref={attach(historyHost)} />,
                },
              ]}
            />
          ) : undefined
        }
      >
        <EditorArea
          workspaceId={workspaceId}
          document={document}
          sourceTypes={new Map(sources.data?.map((source) => [source.id, source.sourceType]))}
          canEdit={canEdit}
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
          navigationTarget={navigationTarget}
          onNavigationChange={setNavigation}
          statusHost={statusHost}
          historyHost={historyHost}
          historyExpanded={tab === 'history'}
          authoringHost={authoringHost}
        />
      </ToolShell>
    </>
  );
}

function EditorArea({
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
  historyHost,
  historyExpanded,
  authoringHost,
  sourceTypes,
}: {
  readonly workspaceId: string;
  readonly document: ReturnType<typeof useDocumentQuery>;
  readonly canEdit: boolean;
  readonly isViewer: boolean;
  readonly authors: readonly { readonly userId: string; readonly name: string }[];
  readonly reloadCount: number;
  readonly onReload: () => void;
  readonly navigationTarget: { readonly position: number } | null;
  readonly onNavigationChange: (navigation: DocumentNavigation) => void;
  readonly statusHost: HTMLElement;
  readonly historyHost: HTMLElement;
  readonly historyExpanded: boolean;
  readonly authoringHost: HTMLElement;
  readonly sourceTypes: ReadonlyMap<string, string>;
}): ReactElement {
  if (document.isPending)
    return (
      <p role="status" aria-live="polite">
        Loading this document…
      </p>
    );
  if (document.error !== null)
    return (
      <>
        <h1>Document</h1>
        <p role="alert">Could not load this document: {describeError(document.error)}</p>
      </>
    );
  return (
    <>
      <h1 className="visually-hidden">{document.data.title}</h1>
      {document.data.archivedAt !== null ? (
        <p role="status">
          This document is archived. It no longer appears in the workspace&apos;s document
          list and can no longer be changed. Its text has not been deleted.
        </p>
      ) : null}
      <DocumentEditorForm
        key={`${document.data.id}-${reloadCount}`}
        workspaceId={workspaceId}
        document={document.data}
        canEdit={canEdit}
        isViewer={isViewer}
        authors={authors}
        sourceTypes={sourceTypes}
        onDiscardLocalChanges={() => {
          void document.refetch().then(onReload);
        }}
        onReplaced={onReload}
        navigationTarget={navigationTarget}
        onNavigationChange={onNavigationChange}
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
