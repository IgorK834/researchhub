import { getIntlLocale } from '../../../shared/i18n';
import { t as uiText, useLocale as useUiLocale } from '../../../shared/i18n';
import { SourceTypeTile } from '../../sources/components/SourceVisuals';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type ReactElement,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ApiError,
  describeError,
  hasApiErrorCode,
  isApiTransportError,
  queryKeys,
} from '../../../shared/api';
import {
  createConversation,
  streamConversationQuestion,
  type ConversationQuestion,
  type ConversationTurn,
  type ConversationMessage,
} from '../api/conversationApi';
import { useConversationsQuery, useConversationHistory } from '../api/useConversations';
import { Button } from '../../../shared/components/Button';
import { ScopeChip } from '../../../shared/components/ScopeChip';
import { AnswerState } from './GroundedAnswer';
import { AnalysisEvidencePicker } from './AnalysisEvidencePicker';
import type { AnalysisEvidenceReference } from '../api/generationApi';
import { Card, EmptyState } from '../../../shared/components/content';
import { Illustration } from '../../../shared/components/Illustration';
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
import { CanvasAiChat } from './CanvasAiChat';
import { AiModeChip } from './AiModeChip';
import { AnswerLanguageSelect } from './AnswerLanguageSelect';
import type { Locale } from '../../../shared/i18n';

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
  readonly initialConversationId?: string;
  readonly canEdit?: boolean;
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
  return (
    <Panel
      key={`${props.workspaceId}:${props.initialSourceId ?? ''}:${props.initialConversationId ?? ''}`}
      {...props}
    />
  );
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
  initialConversationId,
  canEdit,
}: ResearchPanelProps): ReactElement {
  useUiLocale();
  const cache = useQueryClient();
  const [chosen, setChosen] = useState<string | null | undefined>(
    initialConversationId ??
      (initialQuestion !== undefined || initialSourceId !== undefined ? null : undefined),
  );
  const [question, setQuestion] = useState(
    initialQuestion?.question ?? starterQuestion ?? '',
  );
  const [answerLanguage, setAnswerLanguage] = useState<Locale>(
    initialQuestion?.answerLanguage ?? 'en',
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
  const history = useConversationHistory(workspaceId, conversationId);

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
                    ? uiText('ui.ResearchPanel.message001')
                    : uiText('ui.ResearchPanel.message002')
                  : uiText('ui.CanvasAiChat.message038'),
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
        answerLanguage,
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
      aria-label={uiText('ui.ResearchPanel.message003')}
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
                      <small>{uiText('ui.ResearchPanel.message004')}</small>
                      <strong>{source.title}</strong>
                    </div>
                  </div>
                  <p>{uiText('ui.ResearchPanel.message005')}</p>
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
              {uiText('ui.ResearchPanel.message006')}
            </Button>
          </div>
          <div className={styles.actions}>
            <h1>{lastQuestion ?? uiText('ui.ResearchPanel.message007')}</h1>
            <AiModeChip />
            {actions}
          </div>
        </>
      ) : (
        <>
          <h2>{uiText('ui.ResearchPanel.message008')}</h2>
          <AiModeChip />
          <p>{uiText('ui.ResearchPanel.message009')}</p>
          {conversations.isPending ? (
            <p role="status">{uiText('ui.ResearchNavigation.message004')}</p>
          ) : null}
          {conversations.error !== null ? (
            <p role="alert">
              {uiText('ui.ResearchNavigation.message005')}{' '}
              {describeError(conversations.error)}
            </p>
          ) : (
            <>
              <Select
                label={uiText('ui.ResearchPanel.message010')}
                id="research-conversation"
                value={conversationId ?? ''}
                disabled={pending}
                onChange={(event) => choose(event.target.value || null)}
              >
                <option value="">{uiText('ui.ResearchPanel.message011')}</option>
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </Select>
              <Button variant="secondary" icon="plus" onClick={() => choose(null)}>
                {uiText('ui.ResearchPanel.message011')}
              </Button>
              {conversations.hasNextPage ? (
                <Button
                  variant="ghost"
                  disabled={conversations.isFetchingNextPage}
                  onClick={() => {
                    void conversations.fetchNextPage();
                  }}
                >
                  {uiText('ui.ResearchNavigation.message008')}
                </Button>
              ) : null}
            </>
          )}
        </>
      )}
      <div aria-label={uiText('ui.ResearchPanel.message012')} className={styles.history}>
        {!conversations.isPending &&
        conversations.error === null &&
        !sources.loading &&
        sources.error === null &&
        (conversationId === null || !history.isPending) &&
        history.error === null &&
        messages.length === 0 &&
        visibleCompletion === null &&
        !pending &&
        error === null &&
        !notice ? (
          <EmptyState
            title={uiText('ui.ResearchPanel.message013')}
            description={uiText('ui.ResearchPanel.message014')}
            art={
              <Illustration
                scene={variant === 'page' ? 'hero' : 'magnifier'}
                size={variant === 'page' ? 'default' : 'compact'}
              />
            }
            tone={variant === 'page' ? 'lavender' : 'blue'}
            size={variant === 'page' ? 'default' : 'compact'}
            headingLevel={variant === 'page' ? 'h2' : 'h3'}
          />
        ) : null}
        {conversationId !== null && history.isPending ? (
          <p role="status">{uiText('ui.ResearchPanel.message015')}</p>
        ) : null}
        {history.error !== null ? (
          <p role="alert">
            {uiText('ui.ResearchPanel.message016')} {describeError(history.error)}
          </p>
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
                {uiText('ui.CanvasAiChat.message020')}
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
      {sources.loading ? (
        <p role="status">{uiText('ui.ResearchPanel.message017')}</p>
      ) : null}
      {sources.error !== null ? <p role="alert">{sources.error}</p> : null}
      {!sources.loading &&
      sources.error === null &&
      !sources.sources.some((item) => item.ready) ? (
        <p>{uiText('ui.ResearchPanel.message018')}</p>
      ) : null}
      {initialSourceId !== undefined &&
      scope === 'source' &&
      !sources.loading &&
      !source?.ready ? (
        <Banner tone="note" lead={uiText('ui.ResearchPanel.message036')}>
          {uiText('ui.ResearchPanel.message019')}
        </Banner>
      ) : null}
      {error !== null ? (
        <AnswerState
          state="failed"
          message={describeError(error)}
          retryLabel={uiText('ui.ResearchPanel.message024')}
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
          stopLabel={uiText('ui.ResearchPanel.message037')}
          onStop={() => {
            stop();
            setNotice(uiText('ui.ResearchPanel.message039'));
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
                get title() {
                  return uiText('ui.ResearchPanel.message020');
                },
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
        <AnswerLanguageSelect
          value={answerLanguage}
          onChange={setAnswerLanguage}
          disabled={pending}
        />
        <Textarea
          ref={questionInput}
          label={uiText('ui.ResearchPanel.message021')}
          id="research-question"
          value={question}
          maxLength={2000}
          disabled={pending}
          placeholder={uiText('ui.ResearchPanel.message022')}
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
            {uiText('ui.ResearchPanel.message023')}
          </Button>
          {!pending && retryable && error === null ? (
            <Button
              variant="secondary"
              icon="refresh"
              onClick={() => {
                if (attempt !== null) void run(attempt);
              }}
            >
              {uiText('ui.ResearchPanel.message024')}
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
          {uiText('ui.ResearchPanel.message025')}
        </Button>
      ) : null}
    </section>
  );
  const displayed =
    history.data?.pages[0]?.conversation.origin && conversationId ? (
      <CanvasAiChat
        key={conversationId}
        workspaceId={workspaceId}
        conversationId={conversationId}
        canEdit={canEdit}
      />
    ) : (
      content
    );
  return variant === 'page' ? (
    <ToolShell
      label={uiText('ui.ResearchPanel.message007')}
      secondaryLabel={uiText('ui.ResearchNavigation.message002')}
      secondary={investigations}
      contextTitle={uiText('ui.ResearchPanel.message038')}
      contextOpen={contextOpen}
      onContextOpenChange={setContextOpen}
      context={
        <div className={styles.context}>
          {scopePanel}
          <CitationPanel selected={inspected} />
        </div>
      }
    >
      {displayed}
    </ToolShell>
  ) : (
    displayed
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
  useUiLocale();
  return (
    <article
      aria-label={
        message.role === 'USER'
          ? uiText('ui.ResearchPanel.message026')
          : uiText('ui.ResearchPanel.message027')
      }
      className={styles.message}
    >
      <strong>
        {message.role === 'USER'
          ? uiText('ui.ResearchPanel.message028')
          : uiText('ui.ResearchPanel.message029')}
      </strong>{' '}
      <time dateTime={message.createdAt}>
        {new Date(message.createdAt).toLocaleString(getIntlLocale())}
      </time>
      {message.role === 'USER' ? (
        <p className={styles.messageScope}>
          {message.selectedSourceIds === null
            ? uiText('ui.ResearchPanel.message030')
            : uiText('ui.ResearchPanel.message031', {
                value0:
                  message.selectedSourceIds
                    .map(
                      (id) =>
                        sources.sources.find((source) => source.id === id)?.title ?? id,
                    )
                    .join(', ') || uiText('ui.ResearchPanel.message032'),
              })}
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
      {message.status === 'PENDING' ? (
        <p role="status">{uiText('ui.ResearchPanel.message033')}</p>
      ) : null}
      {message.status === 'FAILED' || message.status === 'ABANDONED' ? (
        <p>
          {message.errorCode === 'AI_OUTPUT_INVALID'
            ? uiText('ui.ResearchPanel.message034')
            : uiText('ui.ResearchPanel.message035')}
        </p>
      ) : null}
    </article>
  );
}
