import { useState, type ReactElement } from 'react';
import { useMutation } from '@tanstack/react-query';
import { describeError } from '../../../shared/api';
import { useSourcesQuery } from '../../sources/api/useSources';
import { askWorkspaceQuestion, type WorkspaceQuestion } from '../api/questionApi';
import { StructuredResponse } from './StructuredResponse';

/** Reset local questions/results when navigating to another workspace. */
export function WorkspaceQuestions({
  workspaceId,
}: {
  readonly workspaceId: string;
}): ReactElement {
  return <QuestionForm key={workspaceId} workspaceId={workspaceId} />;
}

function QuestionForm({ workspaceId }: { readonly workspaceId: string }): ReactElement {
  const sources = useSourcesQuery(workspaceId);
  const [question, setQuestion] = useState('');
  const [scope, setScope] = useState('all');
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [validation, setValidation] = useState<string | null>(null);
  const ask = useMutation({
    mutationFn: (input: WorkspaceQuestion) => askWorkspaceQuestion(workspaceId, input),
  });
  const ready = sources.data?.filter((source) => source.status === 'READY') ?? [];

  return (
    <section aria-labelledby="workspace-questions-heading">
      <h2 id="workspace-questions-heading">Ask workspace sources</h2>
      <p>
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
          if (!question.trim()) {
            setValidation('Enter a question.');
            return;
          }
          setValidation(null);
          ask.mutate({
            question: question.trim(),
            ...(scope === 'selected' ? { selectedSourceIds: selected } : {}),
          });
        }}
      >
        <p>
          <label htmlFor="workspace-question">Question</label>
          <textarea
            id="workspace-question"
            maxLength={2000}
            value={question}
            disabled={ask.isPending}
            onChange={(event) => setQuestion(event.target.value)}
          />
        </p>
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
          {scope === 'selected' ? (
            <div>
              {ready.map((source) => (
                <label key={source.id}>
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
                  {source.displayName}
                </label>
              ))}
              {selected.length === 0 ? (
                <p>No sources selected. The answer will have no evidence.</p>
              ) : null}
            </div>
          ) : null}
        </fieldset>
        {validation !== null ? <p role="alert">{validation}</p> : null}
        {ask.error !== null ? <p role="alert">{describeError(ask.error)}</p> : null}
        {ask.isPending ? (
          <p role="status" aria-live="polite">
            Searching sources and answering…
          </p>
        ) : null}
        <button
          type="submit"
          disabled={ask.isPending || sources.isPending || sources.error !== null}
        >
          {ask.isPending ? 'Answering…' : 'Ask question'}
        </button>
      </form>
      {ask.data !== undefined && !ask.isPending && ask.error === null ? (
        <section aria-label="Workspace answer" aria-live="polite">
          <p>Question: {ask.variables?.question}</p>
          {ask.data.generation === null ? (
            <p>{ask.data.answer}</p>
          ) : (
            <StructuredResponse response={ask.data.generation} />
          )}
        </section>
      ) : null}
    </section>
  );
}
