import { t as uiText, useLocale as useUiLocale } from '../../../shared/i18n';
import { useEffect, useId, useRef, useState, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { apiClient, describeError } from '../../../shared/api';
import type { CanvasContext } from '../../documents/provenance/canvasTarget';
import { useCanvasConversation } from '../api/useCanvasConversation';
import { canvasFailure, describeCanvasFailure } from '../api/canvasFailures';
import { citationPath, analysisCitationPath } from '../api/generationApi';
import type { CanvasScope, CanvasTurnRequest } from '../api/conversationApi';
import { CanvasProposalPreview } from './CanvasProposalPreview';
import { useSourcesQuery } from '../../sources/api/useSources';
import { SourcePicker } from './SourcePicker';
import { AnalysisEvidencePicker } from './AnalysisEvidencePicker';
import { Button } from '../../../shared/components/Button';
import { Textarea } from '../../../shared/components/forms';
import styles from './CanvasAiChat.module.css';
import { CanvasDatasetPicker } from './CanvasDatasetPicker';
import { CalculationPackagePicker } from './CalculationPackagePicker';
import { ReferencedOutput } from '../../documents/components/DocumentAnalysisBlock';
import type { AnalysisInput } from '../../analysis/api/analysisApi';
import { fetchExecutionRecord } from '../../analysis/api/analysisApi';
import type { Locale } from '../../../shared/i18n';
import { AnswerLanguageSelect } from './AnswerLanguageSelect';

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
  canApply = true,
  onApplying,
  onApplied,
}: {
  readonly workspaceId: string;
  readonly context?: CanvasContext;
  readonly conversationId?: string | null;
  readonly canEdit?: boolean;
  readonly documentTitle?: string;
  readonly onClose?: () => void;
  readonly onChangeContext?: () => void;
  readonly proposal?: CanvasProposalReference;
  readonly canApply?: boolean;
  readonly onApplying?: (value: boolean) => void;
  readonly onApplied?: () => Promise<void>;
}): ReactElement {
  useUiLocale();
  const chat = useCanvasConversation(workspaceId, initialId);
  const navigate = useNavigate();
  const id = useId();
  const input = useRef<HTMLTextAreaElement>(null);
  const [instruction, setInstruction] = useState('');
  const [answerLanguage, setAnswerLanguage] = useState<Locale>('en');
  const [scope, setScope] = useState<CanvasScope | null>(null);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [reply, setReply] = useState<string | null>(null);
  const [proposal, setProposal] = useState(initialProposal);
  const [intent, setIntent] = useState<CanvasTurnRequest['intent']>('ANSWER');
  const [datasetInputs, setDatasetInputs] = useState<readonly AnalysisInput[]>([]);
  const [packagesOpen, setPackagesOpen] = useState(false);
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
  const focusContextId = pinned?.contextId;
  useEffect(() => {
    if (focusOnOpen && focusContextId !== undefined) input.current?.focus();
  }, [focusOnOpen, focusContextId]);
  const busy = chat.submitting || chat.pending !== undefined;
  const unavailable =
    busy ||
    chat.retryAvailable ||
    pinned === undefined ||
    chat.history.error !== null ||
    snapshot.error !== null;
  return (
    <section
      aria-label={uiText('ui.CanvasAiChat.message001')}
      className={styles.chat}
      data-canvas-conversation-id={chat.conversationId ?? undefined}
    >
      <div className={styles.context}>
        <strong>
          {documentTitle ?? origin?.documentTitle ?? uiText('ui.CanvasAiChat.message002')}
        </strong>
        <p>
          {uiText('ui.CanvasAiChat.message003')}{' '}
          {pinned?.snapshot.target.kind === 'CARET'
            ? uiText('ui.CanvasAiChat.message004')
            : pinned?.snapshot.target.kind === 'ANALYSIS'
              ? uiText('ui.CanvasAiChat.message005')
              : uiText('ui.AuthoringPanel.message040')}
          {uiText('ui.CanvasAiChat.message006')}
        </p>
        {pinned ? (
          <blockquote>
            {pinned.snapshot.formulas?.map((math) => math.accessibleText).join('; ') ||
              pinned.snapshot.text ||
              `${pinned.snapshot.before} | ${pinned.snapshot.after}`}
          </blockquote>
        ) : (
          <p role="status">{uiText('ui.CanvasAiChat.message007')}</p>
        )}
        <p>
          {uiText('ui.CanvasAiChat.message008')} {currentScope.sourceVersionIds.length}{' '}
          {uiText('ui.CanvasAiChat.message009')} {currentScope.analysisOutputs.length}
        </p>
        <small>{uiText('ui.CanvasAiChat.message010')}</small>
        {!canEdit ? <p>{uiText('ui.CanvasAiChat.message011')}</p> : null}
        <div className={styles.actions}>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => setScopeOpen(!scopeOpen)}
          >
            {uiText('ui.CanvasAiChat.message012')}
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
              {uiText('ui.CanvasAiChat.message013')}
            </Button>
          ) : null}
          {documentId ? (
            <>
              {canEdit ? (
                <Button
                  variant="ghost"
                  disabled={busy || pinned === undefined}
                  onClick={() => setPackagesOpen(!packagesOpen)}
                >
                  {packagesOpen
                    ? uiText('ui.CanvasAiChat.message014')
                    : uiText('ui.CanvasAiChat.message015')}
                </Button>
              ) : null}
              <Button
                variant="ghost"
                onClick={() => {
                  void navigate(`/app/workspaces/${workspaceId}/documents/${documentId}`);
                }}
              >
                {uiText('ui.CanvasAiChat.message016')}
              </Button>
            </>
          ) : null}
        </div>
      </div>
      {packagesOpen && pinned && documentId ? (
        <CalculationPackagePicker
          key={pinned.contextId}
          workspaceId={workspaceId}
          documentId={documentId}
          contextId={pinned.contextId}
          conversationId={chat.conversationId}
          turnId={chat.lastTurn?.turnId ?? null}
          canApply={canApply && !busy}
          onApplying={onApplying}
          onApplied={onApplied}
        />
      ) : null}
      {intent === 'ANALYZE' ? (
        <CanvasDatasetPicker
          workspaceId={workspaceId}
          sources={sources.data ?? []}
          value={datasetInputs}
          disabled={busy}
          onChange={(inputs) => {
            setDatasetInputs(inputs);
            setScope({
              ...currentScope,
              sourceVersionIds: inputs.map((i) => i.sourceVersionId),
            });
          }}
        />
      ) : null}
      {scopeOpen ? (
        <div className={styles.scope}>
          {sources.error ? <p role="alert">{describeError(sources.error)}</p> : null}
          <SourcePicker
            legend={uiText('ui.CanvasAiChat.message061')}
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
          <small>{uiText('ui.CanvasAiChat.message017')}</small>
        </div>
      ) : null}
      <div
        className={styles.messages}
        aria-label={uiText('ui.CanvasAiChat.message018')}
        aria-live="polite"
      >
        {chat.history.isPending && chat.conversationId ? (
          <p role="status">{uiText('ui.CanvasAiChat.message019')}</p>
        ) : null}
        {chat.history.hasNextPage ? (
          <Button
            variant="ghost"
            disabled={chat.history.isFetchingNextPage}
            onClick={() => {
              void chat.history.fetchNextPage();
            }}
          >
            {uiText('ui.CanvasAiChat.message020')}
          </Button>
        ) : null}
        {chat.messages.map((message) => (
          <article
            key={message.id}
            aria-label={
              message.role === 'USER'
                ? uiText('ui.CanvasAiChat.message021')
                : uiText('ui.CanvasAiChat.message022')
            }
          >
            <strong>
              {message.role === 'USER'
                ? uiText('ui.CanvasAiChat.message023')
                : uiText('ui.CanvasAiChat.message024')}
            </strong>
            <p>{message.content}</p>
            {message.status === 'PENDING' ? (
              <p role="status">{uiText('ui.CanvasAiChat.message025')}</p>
            ) : null}
            {message.status === 'FAILED' || message.status === 'ABANDONED' ? (
              <p role="alert">
                {message.errorCode ?? uiText('ui.CanvasAiChat.message026')}
                {uiText('ui.CanvasAiChat.message027')}
              </p>
            ) : null}
            {message.response?.citations.map((citation) => (
              <a key={citation.chunkId} href={citationPath(citation)}>
                {citation.title ?? uiText('ui.AiDraftBlock.message007')}{' '}
              </a>
            ))}
            {message.role === 'USER' &&
            (message.status === 'FAILED' || message.status === 'ABANDONED') ? (
              <div>
                <p role="alert">
                  {message.status === 'ABANDONED'
                    ? uiText('ui.CanvasAiChat.message028')
                    : canvasFailure(message.errorCode)}
                </p>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    setInstruction(message.content);
                    input.current?.focus();
                  }}
                >
                  {uiText('ui.CanvasAiChat.message029')}
                </Button>
              </div>
            ) : null}
            {message.response?.analysisCitations?.map((citation) => (
              <a key={citation.evidenceId} href={analysisCitationPath(citation)}>
                {citation.title}{' '}
              </a>
            ))}
            {chat.turns
              .filter(
                (turn) =>
                  turn.messageId === message.id &&
                  turn.resultKind === 'EDIT_PROPOSAL' &&
                  turn.proposalId &&
                  documentId,
              )
              .map((turn) => (
                <CanvasProposalPreview
                  key={turn.turnId}
                  workspaceId={workspaceId}
                  documentId={documentId!}
                  proposalId={turn.proposalId!}
                  canEdit={canEdit}
                  canApply={canApply}
                  onApplying={onApplying}
                  onApplied={onApplied}
                />
              ))}
            {chat.turns.some(
              (turn) =>
                turn.messageId === message.id &&
                (turn.resultKind === 'ANALYSIS_HANDOFF' ||
                  turn.resultKind === 'PROBLEM_HANDOFF'),
            ) ? (
              <a
                href={`/app/workspaces/${workspaceId}/analyses${message.canvasResult?.analysisId ? `/${message.canvasResult.analysisId}` : ''}`}
              >
                {uiText('ui.CanvasAiChat.message030')}
              </a>
            ) : null}
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
                      get title() {
                        return uiText('ui.CanvasAiChat.message031');
                      },
                      sourceVersionIds: turn.scope.sourceVersionIds,
                    })
                  }
                >
                  {uiText('ui.CanvasAiChat.message032')}
                </Button>
              ))}
            {chat.turns
              .filter(
                (t) =>
                  t.messageId === message.id &&
                  t.resultKind === 'ANALYSIS_RESULT' &&
                  t.analysisId &&
                  t.executionId,
              )
              .map((t) => (
                <CanvasDatasetResult
                  key={t.turnId}
                  workspaceId={workspaceId}
                  analysisId={t.analysisId!}
                  executionId={t.executionId!}
                />
              ))}
            {documentId
              ? chat.turns
                  .filter((t) => t.messageId === message.id)
                  .flatMap((t) => t.calculationProposalIds ?? [])
                  .map((pid) => (
                    <CanvasProposalPreview
                      key={pid}
                      workspaceId={workspaceId}
                      documentId={documentId}
                      proposalId={pid}
                      canEdit={canEdit}
                      canApply={canApply}
                      onApplying={onApplying}
                      onApplied={onApplied}
                    />
                  ))
              : null}
            {message.role === 'ASSISTANT' && message.status === 'COMPLETED' ? (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setReply(message.id);
                  input.current?.focus();
                }}
              >
                {uiText('ui.CanvasAiChat.message033')}
              </Button>
            ) : null}
          </article>
        ))}
        {chat.turns
          .filter((turn) => turn.memory && turn.memory.omittedMessages > 0)
          .map((turn) => (
            <small key={turn.turnId}>
              {uiText('ui.CanvasAiChat.message034')} {turn.memory?.omittedMessages}{' '}
              {uiText('ui.CanvasAiChat.message035')}
            </small>
          ))}
        {chat.pending ? (
          <p role="status">
            {chat.pending.status === 'ACCEPTED'
              ? uiText('ui.CanvasAiChat.message036')
              : chat.pending.status === 'EXECUTING'
                ? uiText('ui.CanvasAiChat.message037')
                : uiText('ui.CanvasAiChat.message038')}{' '}
            {uiText('ui.CanvasAiChat.message039')}
            {chat.lastTurn?.status === 'EXECUTING' ? (
              <span> {uiText('ui.CanvasAiChat.message040')}</span>
            ) : null}
          </p>
        ) : null}
      </div>
      {chat.error !== null || chat.history.error !== null || snapshot.error !== null ? (
        <p role="alert">
          {describeCanvasFailure(chat.error ?? chat.history.error ?? snapshot.error)}
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
          {uiText('ui.CanvasAiChat.message041')}
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
              intent,
              intent === 'ANALYZE' && datasetInputs.length ? datasetInputs : undefined,
              answerLanguage,
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
            {uiText('ui.CanvasAiChat.message042')} {proposal.title}
            {uiText('ui.CanvasAiChat.message043')}
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => setProposal(undefined)}
            >
              {uiText('ui.CanvasAiChat.message044')}
            </Button>
          </div>
        ) : null}
        {reply ? (
          <div>
            {uiText('ui.CanvasAiChat.message045')}{' '}
            <Button variant="ghost" onClick={() => setReply(null)}>
              {uiText('ui.CanvasAiChat.message046')}
            </Button>
          </div>
        ) : null}
        <label htmlFor={`${id}-intent`}>{uiText('ui.CanvasAiChat.message047')}</label>
        <select
          id={`${id}-intent`}
          value={intent}
          disabled={busy}
          onChange={(event) =>
            setIntent(event.target.value as CanvasTurnRequest['intent'])
          }
        >
          <option value="ANSWER">{uiText('ui.CanvasAiChat.message048')}</option>
          <option value="CLARIFY">{uiText('ui.CanvasAiChat.message049')}</option>
          {canEdit ? (
            <>
              <option value="EDIT">{uiText('ui.CanvasAiChat.message050')}</option>
              <option value="ANALYZE">{uiText('ui.CanvasAiChat.message051')}</option>
              <option value="SOLVE">{uiText('ui.CanvasAiChat.message052')}</option>
            </>
          ) : null}
        </select>
        <AnswerLanguageSelect
          value={answerLanguage}
          onChange={setAnswerLanguage}
          disabled={busy}
        />
        <Textarea
          ref={input}
          id={`${id}-prompt`}
          label={uiText('ui.CanvasAiChat.message053')}
          maxLength={8000}
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          disabled={busy}
        />
        <div className={styles.actions}>
          <Button
            type="submit"
            icon="send"
            disabled={
              unavailable ||
              !instruction.trim() ||
              (intent === 'ANALYZE' && !datasetInputs.length)
            }
          >
            {uiText('ui.CanvasAiChat.message054')}
          </Button>
          {chat.pending ? (
            <Button
              variant="secondary"
              onClick={() => {
                void chat.cancel();
              }}
            >
              {uiText('ui.CanvasAiChat.message055')}
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
              {uiText('ui.CanvasAiChat.message056')}
            </Button>
          ) : null}
        </div>
      </form>
    </section>
  );
}
function CanvasDatasetResult({
  workspaceId,
  analysisId,
  executionId,
}: {
  readonly workspaceId: string;
  readonly analysisId: string;
  readonly executionId: string;
}): ReactElement {
  useUiLocale();
  const record = useQuery({
    queryKey: ['canvas-run', workspaceId, analysisId, executionId],
    queryFn: ({ signal }) =>
      fetchExecutionRecord(workspaceId, analysisId, executionId, signal),
    retry: false,
  });
  return (
    <section aria-label={uiText('ui.CanvasAiChat.message057')}>
      <a
        href={`/app/workspaces/${workspaceId}/analyses/${analysisId}?execution=${executionId}`}
      >
        {uiText('ui.CanvasAiChat.message058')}
      </a>
      {record.isPending ? (
        <p role="status">{uiText('ui.CanvasAiChat.message059')}</p>
      ) : null}
      {record.error ? <p role="alert">{describeError(record.error)}</p> : null}
      {record.data?.execution.status === 'FAILED' ? (
        <p role="alert">
          {uiText('ui.CanvasAiChat.message060')} {record.data.execution.failureCode}
        </p>
      ) : null}
      {record.data?.execution.status === 'SUCCEEDED'
        ? record.data.execution.result?.outputs.map((output) => (
            <ReferencedOutput
              key={output.name}
              workspaceId={workspaceId}
              reference={{
                analysisId,
                executionId,
                outputId: output.name,
                renderMode: output.kind === 'TEXT' ? 'SUMMARY' : output.kind,
              }}
              caption=""
              canEdit={false}
              onUpdate={() => undefined}
            />
          ))
        : null}
    </section>
  );
}
