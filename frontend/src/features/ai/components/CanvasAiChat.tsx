import { useEffect, useId, useRef, useState, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { apiClient, describeError } from '../../../shared/api';
import type { CanvasContext } from '../../documents/provenance/canvasTarget';
import { useCanvasConversation } from '../api/useCanvasConversation';
import { citationPath, analysisCitationPath } from '../api/generationApi';
import type { CanvasScope } from '../api/conversationApi';
import { useSourcesQuery } from '../../sources/api/useSources';
import { SourcePicker } from './SourcePicker';
import { AnalysisEvidencePicker } from './AnalysisEvidencePicker';
import { Button } from '../../../shared/components/Button';
import { Textarea } from '../../../shared/components/forms';
import styles from './CanvasAiChat.module.css';

export interface CanvasProposalReference {
  readonly id: string;
  readonly title: string;
  readonly sourceVersionIds: readonly string[];
}

/** The cursor popover and full history share the durable conversation controller. */
export function CanvasAiChat({
  workspaceId,
  context,
  conversationId: initialId = null,
  canEdit = false,
  documentTitle,
  onClose,
  onChangeContext,
  proposal: initialProposal,
}: {
  readonly workspaceId: string;
  readonly context?: CanvasContext;
  readonly conversationId?: string | null;
  readonly canEdit?: boolean;
  readonly documentTitle?: string;
  readonly onClose?: () => void;
  readonly onChangeContext?: () => void;
  readonly proposal?: CanvasProposalReference;
}): ReactElement {
  const chat = useCanvasConversation(workspaceId, initialId);
  const navigate = useNavigate();
  const id = useId();
  const input = useRef<HTMLTextAreaElement>(null);
  const [instruction, setInstruction] = useState('');
  const [scope, setScope] = useState<CanvasScope | null>(null);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [reply, setReply] = useState<string | null>(null);
  const [proposal, setProposal] = useState(initialProposal);
  const sources = useSourcesQuery(workspaceId);
  const origin = chat.history.data?.pages[0]?.conversation.origin;
  const contextId = context?.contextId ?? chat.lastTurn?.contextId ?? origin?.contextId;
  const documentId = context?.documentId ?? origin?.documentId;
  const snapshot = useQuery({
    queryKey: ['canvas-context', workspaceId, documentId, contextId],
    enabled:
      contextId !== undefined &&
      documentId !== undefined &&
      context?.contextId !== contextId,
    queryFn: ({ signal }) =>
      apiClient.get<CanvasContext>(
        `/api/workspaces/${workspaceId}/documents/${documentId ?? ''}/ai/contexts/${contextId ?? ''}`,
        { signal },
      ),
    retry: false,
  });
  const pinned = context?.contextId === contextId ? context : snapshot.data;
  const currentScope: CanvasScope = scope ??
    chat.lastTurn?.scope ?? {
      sourceVersionIds: [
        ...new Set(
          proposal?.sourceVersionIds ??
            pinned?.snapshot.sources.flatMap((source) =>
              source.sourceVersionId ? [source.sourceVersionId] : [],
            ) ??
            [],
        ),
      ].slice(0, 12),
      analysisOutputs: pinned?.snapshot.analyses ?? [],
    };
  const focusOnOpen = onClose !== undefined;
  useEffect(() => {
    if (focusOnOpen) input.current?.focus();
  }, [focusOnOpen]);
  const busy = chat.submitting || chat.pending !== undefined;
  const unavailable =
    busy ||
    chat.retryAvailable ||
    pinned === undefined ||
    chat.history.error !== null ||
    snapshot.error !== null;
  return (
    <section
      aria-label="Canvas AI conversation"
      className={styles.chat}
      data-canvas-conversation-id={chat.conversationId ?? undefined}
    >
      <div className={styles.context}>
        <strong>{documentTitle ?? origin?.documentTitle ?? 'Document context'}</strong>
        <p>
          Target:{' '}
          {pinned?.snapshot.target.kind === 'CARET'
            ? 'At the caret'
            : pinned?.snapshot.target.kind === 'ANALYSIS'
              ? 'Selected analysis result'
              : 'Selected text'}
          . This target stays pinned to this conversation.
        </p>
        {pinned ? (
          <blockquote>
            {pinned.snapshot.text ||
              `${pinned.snapshot.before} | ${pinned.snapshot.after}`}
          </blockquote>
        ) : (
          <p role="status">Waiting for saved context…</p>
        )}
        <p>
          Sources: {currentScope.sourceVersionIds.length} selected versions · Saved
          results: {currentScope.analysisOutputs.length}
        </p>
        <small>
          This conversation is saved in workspace history after the first message.
        </small>
        {!canEdit ? (
          <p>Read-only: you can ask questions and explain saved results.</p>
        ) : null}
        <div className={styles.actions}>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => setScopeOpen(!scopeOpen)}
          >
            Change evidence scope
          </Button>
          {onChangeContext ? (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setProposal(undefined);
                onChangeContext();
              }}
            >
              Change context
            </Button>
          ) : null}
          {documentId ? (
            <Button
              variant="ghost"
              onClick={() => {
                void navigate(`/app/workspaces/${workspaceId}/documents/${documentId}`);
              }}
            >
              Open document
            </Button>
          ) : null}
        </div>
      </div>
      {scopeOpen ? (
        <div className={styles.scope}>
          {sources.error ? <p role="alert">{describeError(sources.error)}</p> : null}
          <SourcePicker
            legend="Evidence source versions"
            maxSelected={12}
            sources={(sources.data ?? []).map((s) => ({
              id: s.activeVersionId,
              title: s.displayName,
              status: s.status,
              sourceType: s.sourceType,
            }))}
            value={currentScope.sourceVersionIds}
            onChange={(sourceVersionIds) =>
              setScope({ ...currentScope, sourceVersionIds })
            }
            disabled={busy}
          />
          <AnalysisEvidencePicker
            workspaceId={workspaceId}
            value={currentScope.analysisOutputs}
            onChange={(analysisOutputs) => setScope({ ...currentScope, analysisOutputs })}
            disabled={busy}
          />
          <small>
            Only these versions and results support the next answer. Narrowing scope
            removes earlier evidence from memory.
          </small>
        </div>
      ) : null}
      <div
        className={styles.messages}
        aria-label="Canvas conversation history"
        aria-live="polite"
      >
        {chat.history.isPending && chat.conversationId ? (
          <p role="status">Loading conversation…</p>
        ) : null}
        {chat.history.hasNextPage ? (
          <Button
            variant="ghost"
            disabled={chat.history.isFetchingNextPage}
            onClick={() => {
              void chat.history.fetchNextPage();
            }}
          >
            Load older messages
          </Button>
        ) : null}
        {chat.messages.map((message) => (
          <article
            key={message.id}
            aria-label={message.role === 'USER' ? 'Canvas question' : 'Canvas answer'}
          >
            <strong>{message.role === 'USER' ? 'You' : 'AI'}</strong>
            <p>{message.content}</p>
            {message.status === 'PENDING' ? <p role="status">Preparing answer…</p> : null}
            {message.status === 'FAILED' || message.status === 'ABANDONED' ? (
              <p role="alert">
                {message.errorCode ?? 'Request cancelled'}. No complete answer was saved.
              </p>
            ) : null}
            {message.response?.citations.map((citation) => (
              <a
                key={citation.chunkId}
                href={`${citationPath(citation)}${citation.sourceVersionId ? `&version=${encodeURIComponent(citation.sourceVersionId)}` : ''}`}
              >
                {citation.title ?? 'Source'}{' '}
              </a>
            ))}
            {message.response?.analysisCitations?.map((citation) => (
              <a key={citation.evidenceId} href={analysisCitationPath(citation)}>
                {citation.title}{' '}
              </a>
            ))}
            {chat.turns
              .filter((turn) => turn.messageId === message.id && turn.proposalId)
              .map((turn) => (
                <Button
                  key={turn.turnId}
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    setProposal({
                      id: turn.proposalId!,
                      title: 'Referenced AI proposal',
                      sourceVersionIds: turn.scope.sourceVersionIds,
                    })
                  }
                >
                  Use this proposal as context
                </Button>
              ))}
            {message.role === 'ASSISTANT' && message.status === 'COMPLETED' ? (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setReply(message.id);
                  input.current?.focus();
                }}
              >
                Reply to this answer
              </Button>
            ) : null}
          </article>
        ))}
        {chat.turns
          .filter((turn) => turn.memory && turn.memory.omittedMessages > 0)
          .map((turn) => (
            <small key={turn.turnId}>
              Conversation memory limited: {turn.memory?.omittedMessages} earlier messages
              omitted.
            </small>
          ))}
        {chat.pending ? (
          <p role="status">
            {chat.pending.status === 'ACCEPTED'
              ? 'Question queued…'
              : 'Preparing a grounded answer…'}{' '}
            You can close this window while it runs.
          </p>
        ) : null}
      </div>
      {chat.error !== null || chat.history.error !== null || snapshot.error !== null ? (
        <p role="alert">
          {describeError(chat.error ?? chat.history.error ?? snapshot.error)}
        </p>
      ) : null}
      {chat.retryAvailable ? (
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => {
            void chat.retry();
          }}
        >
          Retry saved request
        </Button>
      ) : null}
      <form
        className={styles.composer}
        onSubmit={(event) => {
          event.preventDefault();
          if (!instruction.trim() || pinned === undefined || unavailable) return;
          void chat
            .send(
              pinned.contextId,
              instruction.trim(),
              currentScope,
              reply,
              proposal?.id ?? null,
            )
            .then((sent) => {
              if (sent) {
                setInstruction('');
                setReply(null);
              }
            });
        }}
      >
        {proposal ? (
          <div>
            Follow-up target: {proposal.title}. The server reads the saved proposal or
            current accepted blocks.
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => setProposal(undefined)}
            >
              Clear proposal target
            </Button>
          </div>
        ) : null}
        {reply ? (
          <div>
            Replying to the selected answer{' '}
            <Button variant="ghost" onClick={() => setReply(null)}>
              Clear reply
            </Button>
          </div>
        ) : null}
        <Textarea
          ref={input}
          id={`${id}-prompt`}
          label="Ask about this context"
          maxLength={8000}
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          disabled={busy}
        />
        <div className={styles.actions}>
          <Button type="submit" icon="send" disabled={unavailable || !instruction.trim()}>
            Send question
          </Button>
          {chat.pending ? (
            <Button
              variant="secondary"
              onClick={() => {
                void chat.cancel();
              }}
            >
              Cancel question
            </Button>
          ) : null}
          {chat.conversationId && onClose ? (
            <Button
              variant="secondary"
              onClick={() => {
                onClose();
                void navigate(
                  `/app/workspaces/${workspaceId}/ask?conversation=${chat.conversationId}`,
                );
              }}
            >
              Open full chat
            </Button>
          ) : null}
        </div>
      </form>
    </section>
  );
}
