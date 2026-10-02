import { SourcePicker } from './SourcePicker';
import { ScopeChip } from '../../../shared/components/ScopeChip';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useMutation } from '@tanstack/react-query';
import { describeError } from '../../../shared/api';
import { useSourcesQuery } from '../../sources/api/useSources';
import { askWorkspaceQuestion, type WorkspaceQuestion } from '../api/questionApi';
import { GroundedAnswer, AnswerState } from './GroundedAnswer';
import { Button } from '../../../shared/components/Button';
import { Textarea } from '../../../shared/components/forms';
import { IconTile } from '../../../shared/components/content';
import styles from './WorkspaceQuestions.module.css';

/** A dataset the user chose to analyze: the question starts scoped to that source. */
export interface QuestionFocus {
  readonly sourceId: string;
  readonly sheetName: string | null;
}

function starterQuestion(focus: QuestionFocus | undefined): string {
  if (focus === undefined) return '';
  const sheet =
    focus.sheetName === null || focus.sheetName === 'CSV'
      ? ''
      : ` Focus on the "${focus.sheetName}" sheet.`;
  return `Describe the columns, data types and data-quality issues in this dataset.${sheet}`;
}

/** Reset local questions/results when navigating to another workspace or dataset. */
export function WorkspaceQuestions({
  workspaceId,
  focus,
  variant = 'full',
  onAsk,
  initialQuestion,
  onInitialQuestionUsed,
  initialSourceId,
}: {
  readonly workspaceId: string;
  readonly focus?: QuestionFocus;
  readonly variant?: 'full' | 'overview';
  readonly onAsk?: (question: WorkspaceQuestion) => void;
  readonly initialQuestion?: WorkspaceQuestion;
  readonly onInitialQuestionUsed?: () => void;
  readonly initialSourceId?: string;
}): ReactElement {
  return (
    <QuestionForm
      key={`${workspaceId}:${initialSourceId ?? focus?.sourceId ?? ''}:${focus?.sheetName ?? ''}`}
      workspaceId={workspaceId}
      variant={variant}
      onAsk={onAsk}
      initialQuestion={initialQuestion}
      onInitialQuestionUsed={onInitialQuestionUsed}
      initialSourceId={initialSourceId}
      {...(focus === undefined ? {} : { focus })}
    />
  );
}

function QuestionForm({
  workspaceId,
  focus,
  variant,
  onAsk,
  initialQuestion,
  onInitialQuestionUsed,
  initialSourceId,
}: {
  readonly workspaceId: string;
  readonly focus?: QuestionFocus;
  readonly variant: 'full' | 'overview';
  readonly onAsk?: (question: WorkspaceQuestion) => void;
  readonly initialQuestion?: WorkspaceQuestion;
  readonly onInitialQuestionUsed?: () => void;
  readonly initialSourceId?: string;
}): ReactElement {
  const sources = useSourcesQuery(workspaceId);
  const [question, setQuestion] = useState(
    () => initialQuestion?.question ?? starterQuestion(focus),
  );
  const [scope, setScope] = useState(
    (initialQuestion?.selectedSourceIds !== undefined &&
      initialQuestion.selectedSourceIds !== null) ||
      focus !== undefined ||
      initialSourceId !== undefined
      ? 'selected'
      : 'all',
  );
  const [selected, setSelected] = useState<readonly string[]>(
    initialQuestion?.selectedSourceIds ??
      (initialSourceId !== undefined
        ? [initialSourceId]
        : focus === undefined
          ? []
          : [focus.sourceId]),
  );
  const questionInput = useRef<HTMLTextAreaElement>(null);
  const focusedSource = initialSourceId ?? focus?.sourceId;
  // Only when a dataset was chosen, and not again for unrelated re-renders of the parent.
  useEffect(() => {
    if (focusedSource !== undefined) questionInput.current?.focus();
  }, [focusedSource]);
  const [validation, setValidation] = useState<string | null>(null);
  const ask = useMutation({
    mutationFn: (input: WorkspaceQuestion) => askWorkspaceQuestion(workspaceId, input),
  });
  const ready = sources.data?.filter((source) => source.status === 'READY') ?? [];
  const initialAsked = useRef(false);
  const mutateQuestion = ask.mutate;
  useEffect(() => {
    // Consume a question from the overview exactly once, including StrictMode effect replay.
    if (
      initialQuestion === undefined ||
      initialAsked.current ||
      sources.isPending ||
      sources.error !== null
    )
      return;
    initialAsked.current = true;
    mutateQuestion(initialQuestion);
    onInitialQuestionUsed?.();
  }, [
    initialQuestion,
    sources.isPending,
    sources.error,
    mutateQuestion,
    onInitialQuestionUsed,
  ]);
  const submitContent =
    variant === 'overview'
      ? {
          iconOnly: true as const,
          icon: 'arrowUp' as const,
          'aria-label': 'Ask question',
        }
      : { icon: 'sparkle' as const, children: 'Ask question' };

  return (
    <section
      aria-labelledby="workspace-questions-heading"
      className={variant === 'overview' ? styles.overview : styles.full}
    >
      <h2
        id="workspace-questions-heading"
        className={variant === 'overview' ? 'visually-hidden' : undefined}
      >
        {variant === 'overview' ? 'Ask across this workspace' : 'Ask workspace sources'}
      </h2>
      <p className={variant === 'overview' ? 'visually-hidden' : undefined}>
        Answers use searchable sources in this workspace and include links to supporting
        passages.
      </p>
      {sources.isPending ? <p role="status">Loading sources for questions…</p> : null}
      {sources.error !== null ? (
        <p role="alert">
          Could not load question sources: {describeError(sources.error)}
        </p>
      ) : null}
      {!sources.isPending && sources.error === null && ready.length === 0 ? (
        <p>No ready sources are available. Questions will return a no-evidence result.</p>
      ) : null}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (ask.isPending) return;
          if (!question.trim()) {
            setValidation('Enter a question.');
            return;
          }
          setValidation(null);
          const input: WorkspaceQuestion = {
            question: question.trim(),
            ...(scope === 'selected' ? { selectedSourceIds: selected } : {}),
          };
          if (onAsk !== undefined) onAsk(input);
          else ask.mutate(input);
        }}
      >
        {variant === 'overview' ? (
          <span className={styles.askIcon} aria-hidden="true">
            <IconTile icon="sparkle" tone="lavender" />
          </span>
        ) : null}
        <div className={styles.question}>
          <Textarea
            label="Question"
            id="workspace-question"
            ref={questionInput}
            maxLength={2000}
            value={question}
            placeholder={
              variant === 'overview' ? 'Ask across this workspace…' : undefined
            }
            aria-invalid={validation !== null}
            aria-describedby={
              validation !== null ? 'workspace-question-error' : undefined
            }
            disabled={ask.isPending}
            onChange={(event) => setQuestion(event.target.value)}
          />
        </div>
        <div className={styles.scope}>
          <ScopeChip
            selectedSourceIds={scope === 'all' ? null : selected}
            readyCount={ready.length}
          />
        </div>
        <details className={styles.scopeOptions} open={variant === 'full'}>
          <summary>Choose source scope</summary>
          <fieldset disabled={ask.isPending}>
            <legend>Sources to search</legend>
            <label>
              <input
                type="radio"
                name="question-scope"
                value="all"
                checked={scope === 'all'}
                onChange={() => setScope('all')}
              />
              All workspace sources
            </label>
            <label>
              <input
                type="radio"
                name="question-scope"
                value="selected"
                checked={scope === 'selected'}
                onChange={() => setScope('selected')}
              />
              Selected sources
            </label>
            <SourcePicker
              sources={(sources.data ?? []).map((source) => ({
                id: source.id,
                title: source.displayName,
                sourceType: source.sourceType,
                status: source.status,
              }))}
              value={scope === 'all' ? null : selected}
              onChange={(ids) => {
                setScope('selected');
                setSelected(ids);
              }}
            />
          </fieldset>
        </details>
        {validation !== null ? (
          <p id="workspace-question-error" role="alert">
            {validation}
          </p>
        ) : null}
        {ask.error !== null ? (
          <AnswerState
            state="failed"
            message={describeError(ask.error)}
            onRetry={
              ask.variables === undefined ? undefined : () => ask.mutate(ask.variables!)
            }
          />
        ) : null}
        {ask.isPending ? (
          <AnswerState state="thinking" message="Searching sources and answering…" />
        ) : null}
        <Button
          {...submitContent}
          className={styles.submit}
          type="submit"
          disabled={ask.isPending || sources.isPending || sources.error !== null}
          busy={ask.isPending}
          busyLabel="Answering…"
          aria-label={ask.isPending ? 'Answering…' : 'Ask question'}
        />
      </form>
      {ask.data !== undefined && !ask.isPending && ask.error === null ? (
        <section aria-label="Workspace answer" aria-live="polite">
          <p>Question: {ask.variables?.question}</p>
          <GroundedAnswer
            status={ask.data.status}
            reason={ask.data.reason}
            answer={ask.data.answer}
            generation={ask.data.generation}
            evidence={ask.data.citations.map((citation, index) => ({
              citation,
              label:
                ask.data.generation?.context?.citations.find(
                  (binding) => binding.chunkId === citation.chunkId,
                )?.citationKey ?? `S${String(index + 1)}`,
              sourceType: sources.data?.find((source) => source.id === citation.sourceId)
                ?.sourceType,
            }))}
          />
        </section>
      ) : null}
    </section>
  );
}
