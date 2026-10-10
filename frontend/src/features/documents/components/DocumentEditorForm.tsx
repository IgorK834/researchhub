import { CanvasContextPreview } from './CanvasContextPreview';
import type { SelectionBookmark } from '@tiptap/pm/state';
import { DocumentProvenance } from '../provenance/DocumentProvenance';
import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

import { describeError, fieldErrorsByName, queryKeys } from '../../../shared/api';
import type { WorkspaceDocument } from '../api/documentApi';
import {
  EMPTY_DOCUMENT,
  readStoredDocument,
  type ProseMirrorDocument,
} from '../api/documentContent';
import { useArchiveDocument } from '../api/useDocuments';
import { useDocumentAutosave } from '../autosave/useDocumentAutosave';
import { DocumentBodyEditor, type AuthoringSelection } from './DocumentBodyEditor';
import type { DocumentNavigation } from '../api/documentNavigation';
import styles from './DocumentPaper.module.css';
import { Icon } from '../../../shared/components/icons';
import { Button } from '../../../shared/components/Button';
import { useRealtimeDocument } from '../collaboration/useRealtimeDocument';
import { DocumentHistory } from './DocumentHistory';
import { DocumentPresence } from './DocumentPresence';
import { SaveStatus } from './SaveStatus';
import { DocumentViewerNotice } from './DocumentViewerNotice';
import type { SelectionAuthoringRequest } from '../../ai/api/authoringActions';
import type { Editor } from '@tiptap/core';
import type { AuthoringSuggestion } from '../../ai/api/authoringApi';
import type { CanvasProposalReference } from '../../ai/components/CanvasAiChat';
import type { CommentAnchor } from '../comments/commentAnchor';
import { DocumentComments } from '../comments/DocumentComments';
import { ExportDocument } from '../../export/ExportDocument';

export interface DocumentAuthoringContext {
  readonly onExplainSuggestion?: (suggestion: AuthoringSuggestion) => void;
  readonly selectionRequest: SelectionAuthoringRequest | null;
  readonly draftHost: HTMLElement;
  /** View-only placement for draft and rewrite review cards. */
  readonly onDraftPlacementChange: (
    placement: number | null,
    selectionEnd?: number,
  ) => void;
  readonly onReviewing: (reviewing: boolean) => void;
  readonly workspaceId: string;
  readonly documentId: string;
  readonly revision: number;
  readonly settled: boolean;
  readonly selection: AuthoringSelection;
  readonly blockCount: number;
  readonly onBusy: (busy: boolean) => void;
  readonly onAccepted: (document: WorkspaceDocument, focusBlock?: number) => void;
  readonly onReload: () => void;
}

export interface DocumentEditorFormProps {
  readonly exportHost?: HTMLElement;
  readonly commentsHost?: HTMLElement;
  readonly provenanceHost?: HTMLElement;
  readonly onOpenComments?: () => void;
  readonly onOpenAuthoring?: () => void;
  readonly focusBlock?: number;
  readonly renderAuthoring?: (context: DocumentAuthoringContext) => ReactNode;
  readonly historyHost?: HTMLElement;
  readonly sourceTypes?: ReadonlyMap<string, string>;
  readonly historyExpanded?: boolean;
  readonly presenceHost?: HTMLElement;
  readonly statusHost?: HTMLElement;
  readonly onNavigationChange?: (navigation: DocumentNavigation) => void;
  readonly navigationTarget?: { readonly position: number } | null;
  readonly workspaceId: string;
  readonly document: WorkspaceDocument;
  /**
   * Whether to offer editing, saving, restoring, and archiving.
   *
   * Presentation only. The caller passes `true` for a member who may edit content in an active workspace, and
   * the server checks `EDIT_CONTENT` on every request anyway — a forged save still gets `403`, and one to an
   * archived workspace still gets `409`.
   */
  readonly canEdit: boolean;
  readonly isViewer?: boolean;
  readonly contextCaptureEnabled?: boolean;
  readonly authors?: readonly { readonly userId: string; readonly name: string }[];
  /** Reloads the document and discards local edits. Offered only after a conflict. */
  readonly onDiscardLocalChanges: () => void;
  /** The stored document was replaced by a restore; the caller shows the new one in a fresh editor. */
  readonly onReplaced: (document: WorkspaceDocument, focusBlock?: number) => void;
}

/** Binds the editor to shared Yjs state when enabled; legacy documents retain revision autosave. */
export function DocumentEditorForm({
  exportHost,
  commentsHost,
  provenanceHost,
  onOpenComments,
  workspaceId,
  document,
  canEdit,
  isViewer = false,
  authors = [],
  onDiscardLocalChanges,
  onReplaced,
  renderAuthoring,
  historyHost,
  sourceTypes,
  historyExpanded,
  statusHost,
  presenceHost,
  onNavigationChange,
  navigationTarget,
  onOpenAuthoring,
  focusBlock,
  contextCaptureEnabled = true,
}: DocumentEditorFormProps): ReactElement {
  const [canvasContext, setCanvasContext] = useState<{
    id: string;
    editor: Editor;
    bookmark: SelectionBookmark;
    proposal?: CanvasProposalReference;
  } | null>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [commentEditor, setCommentEditor] = useState<Editor | null>(null);
  const [pendingAnchor, setPendingAnchor] = useState<CommentAnchor | null>(null);
  const archive = useArchiveDocument(workspaceId, document.id);

  // Checked once, against the editor's schema. Null means the stored body is something this editor cannot open
  // faithfully, and editing it would risk saving an emptied or altered copy over it.
  const [storedBody] = useState(() => readStoredDocument(document.content));
  const [legacyTitle, setTitle] = useState(document.title);
  const [toolbarHost] = useState(() => window.document.createElement('div'));
  const [previewHost] = useState(() => window.document.createElement('div'));
  const [draftHost] = useState(() => {
    const host = window.document.createElement('div');
    host.contentEditable = 'false';
    host.className = styles.draftHost!;
    return host;
  });
  const [draftPlacement, setDraftPlacement] = useState<number | null>(null);
  const [reviewSelectionEnd, setReviewSelectionEnd] = useState<number | null>(null);
  const [selectionRequest, setSelectionRequest] =
    useState<SelectionAuthoringRequest | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [body, setBody] = useState<ProseMirrorDocument>(
    () => storedBody ?? EMPTY_DOCUMENT,
  );

  const realtimeRequested =
    process.env.RESEARCHHUB_COLLABORATION_ENABLED === 'true' &&
    canEdit &&
    document.archivedAt === null &&
    storedBody !== null;
  const [realtimeActivated, setRealtimeActivated] = useState(realtimeRequested);
  // Permissions may arrive after the document. Once activated, never fall back to REST autosaves.
  if (realtimeRequested && !realtimeActivated) setRealtimeActivated(true);
  const realtimeEnabled = realtimeRequested || realtimeActivated;
  const legacyAutosave = useDocumentAutosave(
    workspaceId,
    document.id,
    { title: document.title, content: storedBody ?? EMPTY_DOCUMENT },
    document.revision,
    document.updatedAt,
    !realtimeEnabled,
  );

  const realtime = useRealtimeDocument(
    workspaceId,
    document,
    realtimeEnabled,
    (stored) => {
      queryClient.setQueryData(queryKeys.document(workspaceId, document.id), stored);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.documentVersions(workspaceId, document.id),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.documents(workspaceId),
        exact: true,
      });
    },
  );
  const autosave = realtimeEnabled ? realtime.autosave : legacyAutosave;
  const title = realtimeEnabled ? realtime.title : legacyTitle;
  useEffect(() => {
    if (historyExpanded && realtimeEnabled) {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.document(workspaceId, document.id),
      });
    }
  }, [
    historyExpanded,
    realtimeEnabled,
    autosave.revision,
    workspaceId,
    document.id,
    queryClient,
  ]);

  const [aiBusy, setAiBusy] = useState(false);
  const [selection, setSelection] = useState<AuthoringSelection>({
    from: 1,
    to: 1,
    text: '',
    placementBlock: 1,
  });
  const isArchived = document.archivedAt !== null;
  const authoringAvailable =
    canEdit && !isArchived && storedBody !== null && !realtime.accessRevoked;
  const editable =
    authoringAvailable &&
    !aiBusy &&
    (!realtimeEnabled || (realtime.ready && realtime.connected));

  const fieldErrors =
    autosave.status === 'failed' ? fieldErrorsByName(autosave.error) : {};
  const titleError =
    fieldErrors['title'] ??
    (autosave.blocked && editable ? 'A title is required.' : undefined);
  const contentError = fieldErrors['content'];
  const archiveFailure = archive.error !== null ? describeError(archive.error) : null;

  const settled = autosave.status === 'saved';

  return (
    <div className={styles.writingSurface}>
      {canvasContext ? (
        <CanvasContextPreview
          key={canvasContext.id}
          {...canvasContext}
          workspaceId={workspaceId}
          documentId={document.id}
          documentTitle={document.title}
          autosave={autosave}
          realtime={realtimeEnabled ? realtime : undefined}
          onClose={() => setCanvasContext(null)}
        />
      ) : null}
      {exportHost
        ? createPortal(
            <ExportDocument
              workspaceId={workspaceId}
              documentId={document.id}
              revision={autosave.revision}
              settled={
                settled &&
                storedBody !== null &&
                !previewing &&
                !aiBusy &&
                !realtime.accessRevoked &&
                (!realtimeEnabled || realtime.connected)
              }
            />,
            exportHost,
          )
        : null}
      {provenanceHost
        ? createPortal(
            <DocumentProvenance
              workspaceId={workspaceId}
              documentId={document.id}
              editor={commentEditor}
              onExplainOperation={
                contextCaptureEnabled &&
                !isArchived &&
                !realtime.accessRevoked &&
                commentEditor
                  ? (id, sourceVersionIds) =>
                      setCanvasContext({
                        id: crypto.randomUUID(),
                        editor: commentEditor,
                        bookmark: commentEditor.state.selection.getBookmark(),
                        proposal: { id, title: 'Accepted AI text', sourceVersionIds },
                      })
                  : undefined
              }
            />,
            provenanceHost,
          )
        : null}
      {commentsHost
        ? createPortal(
            <DocumentComments
              workspaceId={workspaceId}
              documentId={document.id}
              editor={commentEditor}
              canComment={authoringAvailable}
              saved={settled && (!realtimeEnabled || realtime.connected)}
              pendingAnchor={pendingAnchor}
              onCancel={() => setPendingAnchor(null)}
              onOpen={onOpenComments ?? (() => {})}
            />,
            commentsHost,
          )
        : null}
      {realtimeEnabled ? (
        presenceHost ? (
          createPortal(<DocumentPresence people={realtime.participants} />, presenceHost)
        ) : (
          <DocumentPresence people={realtime.participants} />
        )
      ) : null}
      {realtimeEnabled && realtime.accessRevoked ? (
        <div role="status" className={styles.connectionBar}>
          <Icon name="lock" size={18} />
          <span>
            {realtime.stateReplaced
              ? 'A snapshot was restored. Load its new state to continue. Earlier local changes are retained separately on this device.'
              : 'Editing access has changed. This editor is read-only. Any unaccepted changes are kept on this device.'}
          </span>
          <Button
            variant="secondary"
            type="button"
            onClick={() => window.location.reload()}
          >
            {realtime.stateReplaced ? 'Load restored snapshot' : 'Check access'}
          </Button>
        </div>
      ) : realtimeEnabled && !realtime.connected ? (
        <div role="status" className={styles.connectionBar}>
          <Icon name="wifiOff" size={18} />
          <span>
            {realtime.ready
              ? 'Offline — changes are kept on this device. Reconnecting…'
              : 'Connecting to collaboration…'}
          </span>
          <Button variant="secondary" type="button" onClick={autosave.retry}>
            Try now
          </Button>
        </div>
      ) : null}
      <SaveStatus
        state={autosave}
        {...(realtimeEnabled
          ? {
              blockedReason: !realtime.connected ? 'waiting for connection' : undefined,
              failureDetail: realtime.failureDetail,
            }
          : {})}
        savedAt={autosave.savedAt}
        onRetry={autosave.retry}
        onDiscardLocalChanges={onDiscardLocalChanges}
        statusHost={statusHost}
      />
      {realtime.accessRevoked ? (
        statusHost ? (
          createPortal(
            <span data-status="readonly">
              <Icon name="eye" size={14} /> Read-only
            </span>,
            statusHost,
          )
        ) : (
          <span data-status="readonly">Read-only</span>
        )
      ) : null}
      {isViewer ? <DocumentViewerNotice statusHost={statusHost} /> : null}

      {archiveFailure !== null ? <p role="alert">{archiveFailure}</p> : null}

      {storedBody === null ? (
        <p role="alert">
          This document contains content this editor cannot open, so it is not shown and
          cannot be edited here. Nothing has been changed.
        </p>
      ) : null}

      <div
        ref={(element) => {
          if (element && previewHost.parentNode !== element)
            element.appendChild(previewHost);
        }}
        hidden={!previewing}
      />
      <div hidden={previewing}>
        {editable ? (
          <div
            className={styles.toolbarHost}
            ref={(element) => {
              if (element && toolbarHost.parentNode !== element)
                element.appendChild(toolbarHost);
            }}
          />
        ) : null}
        <form
          className={styles.paper}
          onSubmit={(event) => {
            event.preventDefault();
            autosave.saveNow();
          }}
          noValidate
        >
          <div>
            <label htmlFor="document-editor-title" className="visually-hidden">
              Title
            </label>
            <textarea
              className={styles.title}
              rows={2}
              maxLength={500}
              ref={(element) => {
                if (element) {
                  element.style.height = '0px';
                  element.style.height = `${Math.max(element.scrollHeight, 44)}px`;
                }
              }}
              id="document-editor-title"
              name="document-editor-title"
              value={title}
              autoComplete="off"
              readOnly={!editable}
              aria-invalid={titleError !== undefined}
              {...(titleError === undefined
                ? {}
                : { 'aria-describedby': 'document-editor-title-error' })}
              onChange={(event) => {
                setTitle(event.target.value);
                autosave.edit({ title: event.target.value, content: body });
              }}
            />
            {titleError === undefined ? null : (
              <span id="document-editor-title-error">{titleError}</span>
            )}
          </div>

          <div>
            <span id="document-editor-text-label" className="visually-hidden">
              Text
            </span>
            {storedBody === null || (realtimeEnabled && !realtime.ready) ? null : (
              <DocumentBodyEditor
                onCanvasAi={
                  !contextCaptureEnabled || isArchived || realtime.accessRevoked
                    ? undefined
                    : (editor, bookmark) =>
                        setCanvasContext({ id: crypto.randomUUID(), editor, bookmark })
                }
                onEditorReady={setCommentEditor}
                onComment={
                  canvasContext === null && commentsHost && authoringAvailable
                    ? (anchor) => {
                        setPendingAnchor(anchor);
                        onOpenComments?.();
                      }
                    : undefined
                }
                workspaceId={workspaceId}
                {...(realtimeEnabled
                  ? {
                      collaborationDocument: realtime.doc,
                      collaborationProvider: realtime.provider,
                      collaborationUser: realtime.user,
                    }
                  : {})}
                selectionActionsEnabled={
                  settled &&
                  !previewing &&
                  !reviewing &&
                  canvasContext === null &&
                  renderAuthoring !== undefined &&
                  !realtimeEnabled
                }
                onSelectionAction={(action, snapshot) => {
                  setSelectionRequest((previous) => ({
                    id: (previous?.id ?? 0) + 1,
                    action,
                    selection: snapshot,
                    revision: autosave.revision,
                  }));
                  onOpenAuthoring?.();
                }}
                draftHost={draftHost}
                draftPlacement={draftPlacement}
                reviewSelectionEnd={reviewSelectionEnd}
                focusBlock={focusBlock}
                sourceTypes={sourceTypes}
                onOpenCitation={(path) => {
                  void navigate(path);
                }}
                initialContent={storedBody}
                toolbarHost={toolbarHost}
                onNavigationChange={onNavigationChange}
                navigationTarget={navigationTarget}
                editable={editable}
                onSelectionChange={setSelection}
                onChange={(content) => {
                  setBody(content);
                  if (!realtimeEnabled) autosave.edit({ title, content });
                }}
                labelId="document-editor-text-label"
                {...(contentError === undefined
                  ? {}
                  : { errorId: 'document-editor-text-error' })}
              />
            )}
            {contentError === undefined ? null : (
              <span id="document-editor-text-error">{contentError}</span>
            )}
          </div>

          {editable ? (
            <div className={styles.saveVersion}>
              <Button
                variant="secondary"
                type="submit"
                disabled={
                  autosave.blocked ||
                  autosave.status === 'conflict' ||
                  (realtimeEnabled && autosave.status !== 'saved')
                }
              >
                Save version
              </Button>{' '}
              {realtimeEnabled
                ? 'Changes save automatically. Save a version to keep a historical snapshot.'
                : 'Changes save automatically. Save a version to keep a restore point you can return to.'}
            </div>
          ) : null}
        </form>
      </div>

      {authoringAvailable && !realtimeEnabled
        ? renderAuthoring?.({
            onExplainSuggestion:
              contextCaptureEnabled && commentEditor
                ? (suggestion) =>
                    setCanvasContext({
                      id: crypto.randomUUID(),
                      editor: commentEditor,
                      bookmark: commentEditor.state.selection.getBookmark(),
                      proposal: {
                        id: suggestion.id,
                        title: 'Saved AI proposal',
                        sourceVersionIds: [
                          ...new Set(
                            suggestion.citations.flatMap((citation) =>
                              citation.sourceVersionId ? [citation.sourceVersionId] : [],
                            ),
                          ),
                        ],
                      },
                    })
                : undefined,
            selectionRequest,
            draftHost,
            onDraftPlacementChange: (placement, selectionEnd) => {
              setDraftPlacement(placement);
              setReviewSelectionEnd(selectionEnd ?? null);
            },
            onReviewing: setReviewing,
            workspaceId,
            documentId: document.id,
            revision: autosave.revision,
            settled: settled && !previewing,
            selection,
            blockCount: body.content?.length ?? 0,
            onBusy: setAiBusy,
            onAccepted: onReplaced,
            onReload: onDiscardLocalChanges,
          })
        : null}

      {(() => {
        const history = (
          <DocumentHistory
            workspaceId={workspaceId}
            documentId={document.id}
            revision={autosave.revision}
            currentDocument={document}
            authors={authors}
            previewHost={previewHost}
            onPreviewChange={setPreviewing}
            canRestore={editable}
            restoreBlockedReason={
              settled ? null : 'Restoring is available once your changes are saved.'
            }
            onRestored={onReplaced}
            expanded={historyExpanded}
          />
        );
        return historyHost === undefined ? history : createPortal(history, historyHost);
      })()}

      {canEdit && !isArchived && !realtime.accessRevoked ? (
        <p>
          <Button
            variant="ghost"
            icon="archive"
            type="button"
            disabled={archive.isPending || !settled || aiBusy}
            onClick={() => {
              archive.mutate();
            }}
          >
            {archive.isPending ? 'Archiving…' : 'Archive document'}
          </Button>
          {settled ? null : ' Archiving is available once your changes are saved.'}
        </p>
      ) : null}
    </div>
  );
}
