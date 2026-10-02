import { useEffect, useRef, useState, type ReactElement } from 'react';
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
  fetchConversations,
  fetchConversationHistory,
  streamConversationQuestion,
  type ConversationQuestion,
  type ConversationTurn,
  type ConversationMessage,
} from '../api/conversationApi';
import { StructuredResponse } from './StructuredResponse';

export interface ResearchSources {
  readonly sources: readonly {
    readonly id: string;
    readonly title: string;
    readonly ready: boolean;
  }[];
  readonly loading: boolean;
  readonly error: string | null;
}
export function ResearchPanel({
  workspaceId,
  sources,
}: {
  readonly workspaceId: string;
  readonly sources: ResearchSources;
}): ReactElement {
  return <Panel key={workspaceId} workspaceId={workspaceId} sources={sources} />;
}
interface Attempt {
  readonly conversationId: string | null;
  readonly question: ConversationQuestion;
}
function Panel({
  workspaceId,
  sources,
}: {
  readonly workspaceId: string;
  readonly sources: ResearchSources;
}): ReactElement {
  const cache = useQueryClient();
  const [chosen, setChosen] = useState<string | null | undefined>(undefined);
  const [question, setQuestion] = useState('');
  const [scope, setScope] = useState('all');
  const [selected, setSelected] = useState<readonly string[]>([]);
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
  const conversations = useInfiniteQuery({
    queryKey: queryKeys.aiConversations(workspaceId),
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      fetchConversations(workspaceId, pageParam, signal),
    getNextPageParam: (page) => page.nextOffset ?? undefined,
    staleTime: 0,
  });
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
  const refresh = async (id: string): Promise<void> => {
    await Promise.all([
      cache.invalidateQueries({ queryKey: queryKeys.aiConversations(workspaceId) }),
      cache.invalidateQueries({ queryKey: queryKeys.aiConversation(workspaceId, id) }),
    ]);
  };
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
  };
  const run = async (input: Attempt): Promise<void> => {
    const current = ++requestNumber.current;
    const abort = new AbortController();
    connection.current = abort;
    setPending(true);
    setError(null);
    setNotice('');
    setDelta('');
    setCompletion(null);
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
                ? 'No relevant passages found.'
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
  };
  return (
    <section
      aria-label="AI research panel"
      style={{
        border: '1px solid var(--color-border)',
        borderRadius: '0.75rem',
        padding: '1rem',
      }}
    >
      <h2>Research conversation</h2>
      <p>Ask about workspace sources. Answers link to the passages that support them.</p>
      {conversations.isPending ? (
        <p role="status">Loading research conversations…</p>
      ) : null}
      {conversations.error !== null ? (
        <p role="alert">
          Could not load conversations: {describeError(conversations.error)}
        </p>
      ) : null}
      {conversations.error === null ? (
        <>
          <label htmlFor="research-conversation">Conversation</label>
          <select
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
          </select>
          <button type="button" onClick={() => choose(null)}>
            New conversation
          </button>
          {conversations.hasNextPage ? (
            <button
              type="button"
              disabled={conversations.isFetchingNextPage}
              onClick={() => {
                void conversations.fetchNextPage();
              }}
            >
              More conversations
            </button>
          ) : null}
        </>
      ) : null}
      <div
        aria-label="Conversation history"
        style={{ maxHeight: '30rem', overflowY: 'auto' }}
      >
        {conversationId !== null && history.isPending ? (
          <p role="status">Loading conversation history…</p>
        ) : null}
        {history.error !== null ? (
          <p role="alert">Could not load history: {describeError(history.error)}</p>
        ) : (
          <>
            {history.hasNextPage ? (
              <button
                type="button"
                disabled={history.isFetchingNextPage}
                onClick={() => {
                  void history.fetchNextPage();
                }}
              >
                Load older messages
              </button>
            ) : null}
            {messages.map((message) => (
              <MessageView key={message.id} message={message} />
            ))}
            {visibleCompletion !== null ? (
              <>
                {messages.some(
                  (message) => message.id === visibleCompletion.user.id,
                ) ? null : (
                  <MessageView message={visibleCompletion.user} />
                )}
                <MessageView message={visibleCompletion.assistant} />
              </>
            ) : null}
          </>
        )}
      </div>
      <form
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
          void run({
            conversationId,
            question: {
              clientRequestId: crypto.randomUUID(),
              question: question.trim(),
              ...(scope === 'selected' ? { selectedSourceIds: selected } : {}),
            },
          });
        }}
      >
        <p>
          <label htmlFor="research-question">Research question</label>
          <textarea
            id="research-question"
            value={question}
            maxLength={2000}
            disabled={pending}
            onChange={(event) => setQuestion(event.target.value)}
            style={{ width: '100%', minHeight: '5rem', boxSizing: 'border-box' }}
          />
        </p>
        <fieldset disabled={pending}>
          <legend>Research scope</legend>
          <label>
            <input
              type="radio"
              name="research-scope"
              checked={scope === 'all'}
              onChange={() => setScope('all')}
            />
            All workspace sources
          </label>
          <label>
            <input
              type="radio"
              name="research-scope"
              checked={scope === 'selected'}
              onChange={() => setScope('selected')}
            />
            Selected sources
          </label>
          {scope === 'selected' ? (
            <div>
              {sources.sources
                .filter((source) => source.ready)
                .map((source) => (
                  <label key={source.id} style={{ display: 'block' }}>
                    <input
                      type="checkbox"
                      checked={selected.includes(source.id)}
                      onChange={(event) =>
                        setSelected((current) =>
                          event.target.checked
                            ? [...current, source.id]
                            : current.filter((id) => id !== source.id),
                        )
                      }
                    />
                    {source.title}
                  </label>
                ))}
              {selected.length === 0 ? (
                <p>No sources selected. The answer will have no evidence.</p>
              ) : null}
            </div>
          ) : null}
        </fieldset>
        {sources.loading ? <p role="status">Loading sources for research…</p> : null}
        {sources.error !== null ? <p role="alert">{sources.error}</p> : null}
        {!sources.loading &&
        sources.error === null &&
        !sources.sources.some((source) => source.ready) ? (
          <p>No ready sources are available yet.</p>
        ) : null}
        {error !== null ? <p role="alert">{describeError(error)}</p> : null}
        {notice ? <p role="status">{notice}</p> : null}
        {pending ? (
          <p role="status" aria-live="polite">
            {progress}
          </p>
        ) : null}
        {delta ? (
          <p aria-label="Answer preview" aria-live="polite">
            {delta}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={
            pending ||
            conversations.isPending ||
            (conversationId !== null && history.isPending) ||
            sources.loading ||
            sources.error !== null ||
            conversations.error !== null ||
            history.error !== null
          }
        >
          Ask research question
        </button>
        {pending ? (
          <button
            type="button"
            onClick={() => {
              stop();
              setNotice(
                'Stopped receiving the answer. Refresh history to see whether it completed.',
              );
              if (conversationId !== null) void refresh(conversationId);
            }}
          >
            Stop answer
          </button>
        ) : null}
        {!pending && retryable ? (
          <button
            type="button"
            onClick={() => {
              if (attempt !== null) void run(attempt);
            }}
          >
            Retry answer
          </button>
        ) : null}
      </form>
      {conversationId !== null ? (
        <button
          type="button"
          disabled={pending || history.isFetching}
          onClick={() => {
            void refresh(conversationId);
          }}
        >
          Refresh history
        </button>
      ) : null}
    </section>
  );
}
function MessageView({
  message,
}: {
  readonly message: ConversationMessage;
}): ReactElement {
  return (
    <article
      aria-label={
        message.role === 'USER' ? 'Research question message' : 'Research answer message'
      }
      style={{ padding: '0.75rem 0', borderBottom: '1px solid var(--color-border)' }}
    >
      <strong>{message.role === 'USER' ? 'Question' : 'Answer'}</strong>{' '}
      <time dateTime={message.createdAt}>
        {new Date(message.createdAt).toLocaleString()}
      </time>
      {message.role === 'ASSISTANT' &&
      message.response !== null &&
      message.response.generation !== null ? (
        <StructuredResponse response={message.response.generation} />
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
