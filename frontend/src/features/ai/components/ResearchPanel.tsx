import { SourceTypeTile } from '../../sources/components/SourceVisuals';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type ReactElement,
} from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import {
  ApiError,
  describeError,
  hasApiErrorCode,
  isApiTransportError,
  queryKeys,
} from '../../../shared/api';
import {
  createConversation,
  fetchConversationHistory,
  streamConversationQuestion,
  type ConversationQuestion,
  type ConversationTurn,
  type ConversationMessage,
} from '../api/conversationApi';
import { useConversationsQuery } from '../api/useConversations';
import { Button } from '../../../shared/components/Button';
import { ScopeChip } from '../../../shared/components/ScopeChip';
import { AnswerState } from './GroundedAnswer';
import { AnalysisEvidencePicker } from './AnalysisEvidencePicker';
import type { AnalysisEvidenceReference } from '../api/generationApi';
import { Card } from '../../../shared/components/content';
import { Banner } from '../../../shared/components/feedback';
import { Select, Textarea } from '../../../shared/components/forms';
import { ToolShell } from '../../../shared/components/shell';
import { ResearchAnswer, CitationPanel, type SelectedCitation } from './ResearchEvidence';
import {
  Investigations,
  ResearchScopePanel,
  scopeLabel,
  type ResearchScope,
} from './ResearchNavigation';
import type { WorkspaceQuestion } from '../api/questionApi';
import styles from './Research.module.css';

export interface ResearchSources {
  readonly sources: readonly {
    readonly id: string;
    readonly title: string;
    readonly ready: boolean;
    readonly sourceType?: string;
    readonly status?: string;
  }[];
  readonly loading: boolean;
  readonly error: string | null;
}
export interface ResearchPanelProps {
  readonly workspaceId: string;
  readonly sources: ResearchSources;
  readonly variant?: 'panel' | 'page';
  readonly actions?: ReactNode;
  readonly initialSourceId?: string;
  readonly initialQuestion?: WorkspaceQuestion;
  readonly starterQuestion?: string;
  readonly onInitialQuestionUsed?: () => void;
}
export function ResearchPanel(props: ResearchPanelProps): ReactElement {
  return <Panel key={`${props.workspaceId}:${props.initialSourceId ?? ''}`} {...props} />;
}
interface Attempt {
  readonly conversationId: string | null;
  readonly question: ConversationQuestion;
}
function Panel({
  workspaceId,
  sources,
  variant = 'panel',
  initialSourceId,
  initialQuestion,
  starterQuestion,
  onInitialQuestionUsed,
  actions,
}: ResearchPanelProps): ReactElement {
  const cache = useQueryClient();
  const [chosen, setChosen] = useState<string | null | undefined>(
    initialQuestion !== undefined || initialSourceId !== undefined ? null : undefined,
  );
  const [question, setQuestion] = useState(
    initialQuestion?.question ?? starterQuestion ?? '',
  );
  const [scopeChoice, setScope] = useState<ResearchScope | null>(
    initialSourceId !== undefined
      ? 'source'
      : initialQuestion?.selectedSourceIds !== undefined &&
          initialQuestion.selectedSourceIds !== null
        ? 'selected'
        : variant === 'page'
          ? null
          : 'all',
  );
  const [selectedChoice, setSelected] = useState<readonly string[] | null>(
    initialSourceId !== undefined
      ? [initialSourceId]
      : (initialQuestion?.selectedSourceIds ?? null),
  );
  const [selectedCitation, setSelectedCitation] = useState<SelectedCitation | null>(null);
  const [computedChoice, setComputedChoice] = useState<
    readonly AnalysisEvidenceReference[] | null
  >(initialQuestion?.selectedAnalysisOutputs ?? null);
  const [contextOpen, setContextOpen] = useState(false);
  const initialUsed = useRef(false);
  const questionInput = useRef<HTMLTextAreaElement>(null);
  const [pending, setPending] = useState(false);
  const [progress, setProgress] = useState('');
  const [delta, setDelta] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState('');
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [completion, setCompletion] = useState<ConversationTurn | null>(null);
  const connection = useRef<AbortController | null>(null);
  const requestNumber = useRef(0);
  useEffect(
    () => () => {
      requestNumber.current++;
      connection.current?.abort();
    },
    [],
  );
  const conversations = useConversationsQuery(workspaceId);
  const items = conversations.data?.pages.flatMap((page) => page.items) ?? [];
  const conversationId = chosen === undefined ? (items[0]?.id ?? null) : chosen;
  const history = useInfiniteQuery({
    queryKey: queryKeys.aiConversation(workspaceId, conversationId ?? ''),
    enabled: conversationId !== null,
    initialPageParam: null as number | null,
    queryFn: ({ pageParam, signal }) =>
      fetchConversationHistory(workspaceId, conversationId ?? '', pageParam, signal),
    getNextPageParam: (page) => page.nextBeforeSequence ?? undefined,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: (query) =>
      query.state.error === null &&
      query.state.data?.pages.some((page) =>
        page.messages.some((message) => message.status === 'PENDING'),
      )
        ? 2000
        : false,
  });
  const messages = [...(history.data?.pages ?? [])]
    .reverse()
    .flatMap((page) => page.messages);
  const visibleCompletion =
    completion !== null &&
    !messages.some((message) => message.id === completion.assistant.id)
      ? completion
      : null;
  const retryable =
    attempt !== null &&
    (isApiTransportError(error) ||
      hasApiErrorCode(error, 'AI_UNAVAILABLE') ||
      notice !== '');
  const refresh = useCallback(
    async (id: string): Promise<void> => {
      await Promise.all([
        cache.invalidateQueries({ queryKey: queryKeys.aiConversations(workspaceId) }),
        cache.invalidateQueries({ queryKey: queryKeys.aiConversation(workspaceId, id) }),
      ]);
    },
    [cache, workspaceId],
  );
  const stop = (): void => {
    requestNumber.current++;
    connection.current?.abort();
    connection.current = null;
    setPending(false);
    setProgress('');
    setDelta('');
  };
  const choose = (id: string | null): void => {
    stop();
    setChosen(id);
    setCompletion(null);
    setError(null);
    setAttempt(null);
    setNotice('');
    setQuestion('');
    setSelectedCitation(null);
    setComputedChoice(null);
    if (variant === 'page') {
      setScope(null);
      setSelected(null);
    }
  };
  const run = useCallback(
    async (input: Attempt): Promise<void> => {
      const current = ++requestNumber.current;
      const abort = new AbortController();
      connection.current = abort;
      setPending(true);
      setError(null);
      setNotice('');
      setDelta('');
      setCompletion(null);
      setSelectedCitation(null);
      setProgress('Starting research question…');
      setAttempt(input);
      let id = input.conversationId;
      try {
        if (id === null) {
          const created = await createConversation(
            workspaceId,
            [...input.question.question].slice(0, 80).join(''),
            abort.signal,
          );
          if (current !== requestNumber.current) return;
          id = created.id;
          setChosen(id);
          setAttempt({ ...input, conversationId: id });
          void cache.invalidateQueries({
            queryKey: queryKeys.aiConversations(workspaceId),
          });
        }
        const saved = await streamConversationQuestion(
          workspaceId,
          id,
          input.question,
          (event) => {
            if (current !== requestNumber.current) return;
            if (event.event === 'started') setProgress('Searching authorized sources…');
            if (event.event === 'retrieval_completed')
              setProgress(
                event.data.chunkCount === 0
                  ? input.question.selectedAnalysisOutputs?.length
                    ? 'Preparing saved computation evidence…'
                    : 'No relevant passages found.'
                  : 'Preparing a grounded answer…',
              );
            if (event.event === 'delta') setDelta((text) => text + event.data.text);
          },
          abort.signal,
        );
        if (current !== requestNumber.current) return;
        setCompletion(saved);
        setQuestion('');
        setDelta('');
        await refresh(id);
      } catch (failure) {
        if (current === requestNumber.current) {
          setError(failure);
          setDelta('');
          if (id !== null) await refresh(id);
        }
      } finally {
        if (current === requestNumber.current) {
          setPending(false);
          setProgress('');
          connection.current = null;
        }
      }
    },
    [workspaceId, cache, refresh],
  );
  useEffect(() => {
    if (starterQuestion !== undefined) questionInput.current?.focus();
  }, [starterQuestion]);
  useEffect(() => {
    if (
      initialQuestion === undefined ||
      initialUsed.current ||
      sources.loading ||
      sources.error !== null ||
      conversations.isPending ||
      conversations.error !== null
    )
      return;
    let cancelled = false;
    // Deferring prevents the StrictMode effect rehearsal from sending a duplicate request.
    void Promise.resolve().then(() => {
      if (cancelled || initialUsed.current) return;
      initialUsed.current = true;
      void run({
        conversationId: null,
        question: { ...initialQuestion, clientRequestId: crypto.randomUUID() },
      });
      onInitialQuestionUsed?.();
    });
    return () => {
      cancelled = true;
    };
  }, [
    initialQuestion,
    sources.loading,
    sources.error,
    conversations.isPending,
    conversations.error,
    run,
    onInitialQuestionUsed,
  ]);
  const recordedScope = [...messages]
    .reverse()
    .find((message) => message.role === 'USER')?.selectedSourceIds;
  const selected =
    selectedChoice ??
    recordedScope ??
    (initialSourceId === undefined ? [] : [initialSourceId]);
  const scope =
    scopeChoice ??
    (recordedScope === null
      ? 'all'
      : recordedScope === undefined
        ? initialSourceId === undefined
          ? 'all'
          : 'source'
        : recordedScope.length === 1 && recordedScope[0] === initialSourceId
          ? 'source'
          : 'selected');
  const unavailable =
    pending ||
    conversations.isPending ||
    (conversationId !== null && history.isPending) ||
    sources.loading ||
    sources.error !== null ||
    conversations.error !== null ||
    history.error !== null;
  const lastQuestion =
    completion?.user.content ??
    [...messages].reverse().find((message) => message.role === 'USER')?.content;
  const scopeName = scopeLabel(scope, selected, sources, initialSourceId);
  const source = sources.sources.find((item) => item.id === initialSourceId);
  const send = (text: string, nextScope = scope, ids = selected): void => {
    void run({
      conversationId,
      question: {
        clientRequestId: crypto.randomUUID(),
        question: text.trim(),
        ...((
          computedChoice ??
          [...messages].reverse().find((message) => message.role === 'USER')
            ?.selectedAnalysisOutputs ??
          []
        ).length
          ? {
              selectedAnalysisOutputs:
                computedChoice ??
                [...messages].reverse().find((message) => message.role === 'USER')
                  ?.selectedAnalysisOutputs ??
                [],
            }
          : {}),
        ...(nextScope === 'all'
          ? {}
          : {
              selectedSourceIds: nextScope === 'source' ? [initialSourceId ?? ''] : ids,
            }),
      },
    });
  };
  const changeScope = (next: ResearchScope, ids = selected): void => {
    setScope(next);
    if (next === 'source') setSelected([initialSourceId ?? '']);
    if (next === 'selected') setSelected(ids);
    if (lastQuestion !== undefined && !unavailable) send(lastQuestion, next, ids);
  };
  const scopePanel = (
    <ResearchScopePanel
      sources={sources}
      scope={scope}
      selected={selected}
      sourceId={initialSourceId}
      disabled={unavailable}
      onScope={changeScope}
      onSelected={setSelected}
      onApply={() => {
        if (lastQuestion !== undefined) send(lastQuestion);
      }}
      canApply={lastQuestion !== undefined}
    />
  );
  const inspected = history.error === null ? selectedCitation : null;
  const inspect = (citation: SelectedCitation): void => {
    setSelectedCitation(citation);
    setContextOpen(true);
  };
  const messageView = (message: ConversationMessage): ReactElement => (
    <MessageView
      key={message.id}
      message={message}
      sources={sources}
      selected={inspected}
      onInspect={inspect}
      sourceView={initialSourceId !== undefined}
      onAskAll={() => changeScope('all')}
      disabled={unavailable}
    />
  );
  const investigations = (
    <Investigations
      items={items}
      current={conversationId}
      onChoose={choose}
      loading={conversations.isPending}
      error={conversations.error === null ? null : describeError(conversations.error)}
      hasMore={conversations.hasNextPage}
      morePending={conversations.isFetchingNextPage}
      onMore={() => {
        void conversations.fetchNextPage();
      }}
    />
  );
  const content = (
    <section
      aria-label="AI research panel"
      className={variant === 'page' ? styles.page : styles.panel}
    >
      {variant === 'page' ? (
        <>
          <div className={styles.banner}>
            <div>
              {scope === 'source' && source ? (
                <>
                  <div className={styles.sourceHeading}>
                    <SourceTypeTile sourceType={source.sourceType ?? 'Source'} />
                    <div>
                      <small>ASKING</small>
                      <strong>{source.title}</strong>
                    </div>
                  </div>
                  <p>Only this source is used.</p>
                </>
              ) : (
                <ScopeChip
                  selectedSourceIds={scope === 'all' ? null : selected}
                  sourceCount={sources.sources.length}
                />
              )}
            </div>
            <Button
              variant="secondary"
              size="compact"
              onClick={() => setContextOpen(true)}
            >
              Change scope
            </Button>
          </div>
          <div className={styles.actions}>
            <h1>{lastQuestion ?? 'Ask AI'}</h1>
            {actions}
          </div>
        </>
      ) : (
        <>
          <h2>Research conversation</h2>
          <p>
            Ask about workspace sources. Answers link to the passages that support them.
          </p>
          {conversations.isPending ? (
            <p role="status">Loading research conversations…</p>
          ) : null}
          {conversations.error !== null ? (
            <p role="alert">
              Could not load conversations: {describeError(conversations.error)}
            </p>
          ) : (
            <>
              <Select
                label="Conversation"
                id="research-conversation"
                value={conversationId ?? ''}
                disabled={pending}
                onChange={(event) => choose(event.target.value || null)}
              >
                <option value="">New conversation</option>
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </Select>
              <Button variant="secondary" icon="plus" onClick={() => choose(null)}>
                New conversation
              </Button>
              {conversations.hasNextPage ? (
                <Button
                  variant="ghost"
                  disabled={conversations.isFetchingNextPage}
                  onClick={() => {
                    void conversations.fetchNextPage();
                  }}
                >
                  More conversations
                </Button>
              ) : null}
            </>
          )}
        </>
      )}
      <div aria-label="Conversation history" className={styles.history}>
        {conversationId !== null && history.isPending ? (
          <p role="status">Loading conversation history…</p>
        ) : null}
        {history.error !== null ? (
          <p role="alert">Could not load history: {describeError(history.error)}</p>
        ) : (
          <>
            {history.hasNextPage ? (
              <Button
                variant="ghost"
                disabled={history.isFetchingNextPage}
                onClick={() => {
                  void history.fetchNextPage();
                }}
              >
                Load older messages
              </Button>
            ) : null}
            {messages.map(messageView)}
            {visibleCompletion !== null ? (
              <>
                {messages.some((message) => message.id === visibleCompletion.user.id)
                  ? null
                  : messageView(visibleCompletion.user)}
                {messageView(visibleCompletion.assistant)}
              </>
            ) : null}
          </>
        )}
      </div>
      {sources.loading ? <p role="status">Loading sources for research…</p> : null}
      {sources.error !== null ? <p role="alert">{sources.error}</p> : null}
      {!sources.loading &&
      sources.error === null &&
      !sources.sources.some((item) => item.ready) ? (
        <p>No ready sources are available yet.</p>
      ) : null}
      {initialSourceId !== undefined &&
      scope === 'source' &&
      !sources.loading &&
      !source?.ready ? (
        <Banner tone="note" lead="This source is not ready for questions.">
          Change scope to ask other ready sources.
        </Banner>
      ) : null}
      {error !== null ? (
        <AnswerState
          state="failed"
          message={describeError(error)}
          retryLabel="Retry answer"
          onRetry={
            retryable && attempt !== null
              ? () => {
                  void run(attempt);
                }
              : undefined
          }
        />
      ) : null}
      {notice ? <Banner lead={notice} /> : null}
      {pending ? (
        <AnswerState
          state={delta ? 'streaming' : 'thinking'}
          message={progress}
          preview={delta}
          stopLabel="Stop answer"
          onStop={() => {
            stop();
            setNotice(
              'Stopped receiving the answer. Refresh history to see whether it completed.',
            );
            if (conversationId !== null) void refresh(conversationId);
          }}
        />
      ) : null}

      <form
        className={styles.composer}
        onSubmit={(event) => {
          event.preventDefault();
          if (!question.trim()) {
            setError(
              new ApiError({
                type: 'about:blank',
                title: 'Invalid question',
                status: 400,
                code: 'VALIDATION_FAILED',
                rawCode: 'VALIDATION_FAILED',
                detail: 'Enter a question.',
              }),
            );
            return;
          }
          send(question);
        }}
      >
        <Textarea
          ref={questionInput}
          label="Research question"
          id="research-question"
          value={question}
          maxLength={2000}
          disabled={pending}
          placeholder="Ask a question about your research…"
          onChange={(event) => setQuestion(event.target.value)}
        />
        <AnalysisEvidencePicker
          workspaceId={workspaceId}
          value={
            computedChoice ??
            [...messages].reverse().find((message) => message.role === 'USER')
              ?.selectedAnalysisOutputs ??
            []
          }
          onChange={setComputedChoice}
          disabled={unavailable}
        />
        <div className={styles.actions}>
          <ScopeChip
            selectedSourceIds={scope === 'all' ? null : selected}
            sourceCount={sources.sources.length}
            sourceLabel={scope === 'source' ? source?.title : undefined}
          />
          <Button
            type="submit"
            icon="send"
            disabled={unavailable || (scope === 'source' && !source?.ready)}
          >
            Ask research question
          </Button>
          {!pending && retryable && error === null ? (
            <Button
              variant="secondary"
              icon="refresh"
              onClick={() => {
                if (attempt !== null) void run(attempt);
              }}
            >
              Retry answer
            </Button>
          ) : null}
        </div>
      </form>
      {variant === 'panel' ? (
        <>
          {scopePanel}
          {inspected === null ? null : <CitationPanel selected={inspected} />}
        </>
      ) : null}
      {conversationId !== null ? (
        <Button
          variant="ghost"
          icon="refresh"
          disabled={pending || history.isFetching}
          onClick={() => {
            void refresh(conversationId);
          }}
        >
          Refresh history
        </Button>
      ) : null}
    </section>
  );
  return variant === 'page' ? (
    <ToolShell
      label="Ask AI"
      secondaryLabel="Investigations"
      secondary={investigations}
      contextTitle="Research context"
      contextOpen={contextOpen}
      onContextOpenChange={setContextOpen}
      context={
        <div className={styles.context}>
          {scopePanel}
          <CitationPanel selected={inspected} />
        </div>
      }
    >
      {content}
    </ToolShell>
  ) : (
    content
  );
}
function MessageView({
  message,
  sources,
  selected,
  onInspect,
  sourceView,
  onAskAll,
  disabled,
}: {
  readonly message: ConversationMessage;
  readonly sources: ResearchSources;
  readonly selected: SelectedCitation | null;
  readonly onInspect: (citation: SelectedCitation) => void;
  readonly sourceView: boolean;
  readonly onAskAll: () => void;
  readonly disabled: boolean;
}): ReactElement {
  return (
    <article
      aria-label={
        message.role === 'USER' ? 'Research question message' : 'Research answer message'
      }
      className={styles.message}
    >
      <strong>{message.role === 'USER' ? 'Question' : 'Answer'}</strong>{' '}
      <time dateTime={message.createdAt}>
        {new Date(message.createdAt).toLocaleString()}
      </time>
      {message.role === 'USER' ? (
        <p className={styles.messageScope}>
          {message.selectedSourceIds === null
            ? 'Scope: All workspace sources'
            : `Scope: ${message.selectedSourceIds.map((id) => sources.sources.find((source) => source.id === id)?.title ?? id).join(', ') || 'No sources selected'}`}
        </p>
      ) : null}
      {message.role === 'ASSISTANT' && message.response !== null ? (
        <ResearchAnswer
          response={message.response}
          sources={sources}
          selected={selected}
          onInspect={onInspect}
          sourceView={sourceView}
          onAskAll={onAskAll}
          disabled={disabled}
        />
      ) : (
        <p>{message.content}</p>
      )}
      {message.status === 'PENDING' ? <p role="status">Answer pending…</p> : null}
      {message.status === 'FAILED' || message.status === 'ABANDONED' ? (
        <p>No complete answer was saved for this attempt.</p>
      ) : null}
    </article>
  );
}
