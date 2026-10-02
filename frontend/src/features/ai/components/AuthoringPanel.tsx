import { SourceTypeBadge } from '../../sources/components/SourceVisuals';
import { useRef, useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { describeError, queryKeys } from '../../../shared/api';
import type { WorkspaceDocument } from '../../documents/api/documentApi';
import type { AuthoringSelection } from '../../documents/components/DocumentBodyEditor';
import { useSourcesQuery } from '../../sources/api/useSources';
import { citationPath } from '../api/generationApi';
import {
  acceptAuthoring,
  rejectAuthoring,
  suggestAuthoring,
  type AuthoringAcceptance,
  type AuthoringKind,
  type AuthoringSuggestion,
  type RewriteAction,
} from '../api/authoringApi';

const ACTIONS: readonly [RewriteAction, string][] = [
  ['IMPROVE_ACADEMIC_STYLE', 'Improve academic style'],
  ['SHORTEN', 'Shorten'],
  ['EXPAND', 'Expand'],
  ['CLARIFY', 'Clarify'],
  ['FIX_GRAMMAR', 'Fix grammar'],
  ['EXPLAIN', 'Explain'],
];

/** Server-side approval owns the edit. A retry uses the same proposal and frozen acceptance payload. */
export function AuthoringPanel({
  workspaceId,
  documentId,
  revision,
  settled,
  selection,
  blockCount,
  onBusy,
  onAccepted,
  onReload,
}: {
  readonly workspaceId: string;
  readonly documentId: string;
  readonly revision: number;
  readonly settled: boolean;
  readonly selection: AuthoringSelection;
  readonly blockCount: number;
  readonly onBusy: (busy: boolean) => void;
  readonly onAccepted: (document: WorkspaceDocument) => void;
  readonly onReload: () => void;
}): ReactElement {
  const client = useQueryClient();
  const sources = useSourcesQuery(workspaceId);
  const [kind, setKind] = useState<AuthoringKind>('DRAFT');
  const [action, setAction] = useState<RewriteAction>('IMPROVE_ACADEMIC_STYLE');
  const [instruction, setInstruction] = useState('');
  const [length, setLength] = useState(300);
  const [style, setStyle] = useState('ACADEMIC');
  const [required, setRequired] = useState(true);
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [all, setAll] = useState(true);
  const [placement, setPlacement] = useState('selection');
  const [suggestion, setSuggestion] = useState<AuthoringSuggestion | null>(null);
  const [edited, setEdited] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<AuthoringAcceptance | null>(null);
  // Guard synchronously, before React renders disabled controls (double click).
  const inFlight = useRef(false);
  const ready = sources.data?.filter((source) => source.status === 'READY') ?? [];
  const stale = suggestion !== null && suggestion.command.expectedRevision !== revision;
  const begin = (): boolean => {
    if (inFlight.current) return false;
    inFlight.current = true;
    setBusy(true);
    onBusy(true);
    setError(null);
    return true;
  };
  const end = (unlock = true): void => {
    inFlight.current = false;
    setBusy(false);
    if (unlock) onBusy(false);
  };

  async function generate(): Promise<void> {
    if (!settled) {
      setError('Save your changes before generating a suggestion.');
      return;
    }
    if (kind === 'DRAFT' && (selected.length === 0 || !instruction.trim())) {
      setError('Enter a title/instruction and select sources.');
      return;
    }
    if (
      kind !== 'DRAFT' &&
      (selection.text.trim().length === 0 || selection.text.length > 2000)
    ) {
      setError('Select 1–2000 characters of prose in the document.');
      return;
    }
    if (!begin()) return;
    try {
      const result = await suggestAuthoring(workspaceId, documentId, {
        kind,
        expectedRevision: revision,
        placementBlock:
          kind === 'DRAFT'
            ? placement === 'selection'
              ? selection.placementBlock
              : Number(placement)
            : null,
        from: kind === 'DRAFT' ? null : selection.from,
        to: kind === 'DRAFT' ? null : selection.to,
        action: kind === 'REWRITE' ? action : null,
        instruction:
          instruction.trim() ||
          (kind === 'EVIDENCE'
            ? 'Find evidence for this claim.'
            : 'Rewrite the selected fragment.'),
        selectedSourceIds:
          kind === 'EVIDENCE' && all
            ? null
            : kind === 'REWRITE' && action !== 'EXPAND'
              ? []
              : selected,
        lengthTarget: length,
        stylePreset: style,
        citationRequired:
          kind === 'DRAFT'
            ? required
            : kind === 'REWRITE' &&
              action === 'EXPAND' &&
              selected.length > 0 &&
              required,
      });
      setSuggestion(result);
      setEdited(result.generatedText);
      setEditing(false);
      setAttempt(null);
    } catch (failure) {
      setError(describeError(failure));
    } finally {
      end();
    }
  }
  async function reject(): Promise<void> {
    if (suggestion === null || !begin()) return;
    try {
      await rejectAuthoring(workspaceId, documentId, suggestion.id);
      setSuggestion(null);
    } catch (failure) {
      setError(describeError(failure));
    } finally {
      end();
    }
  }
  async function accept(citationChunkId: string | null = null): Promise<void> {
    if (suggestion === null || !settled || stale || !begin()) return;
    const input = attempt ?? {
      expectedRevision: suggestion.command.expectedRevision,
      editedText: editing ? edited : null,
      citationChunkId,
    };
    setAttempt(input);
    try {
      const result = await acceptAuthoring(workspaceId, documentId, suggestion.id, input);
      client.setQueryData(queryKeys.document(workspaceId, documentId), result.document);
      void client.invalidateQueries({
        queryKey: queryKeys.documentVersions(workspaceId, documentId),
      });
      void client.invalidateQueries({ queryKey: queryKeys.documents(workspaceId) });
      setSuggestion(null);
      onAccepted(result.document);
      end();
    } catch (failure) {
      setError(
        `${describeError(failure)} Retry the same acceptance or load the latest document.`,
      );
      // An interrupted response may have committed. Freeze local edits until retry/reload resolves it.
      end(false);
    }
  }
  const approvalBlocked = busy || !settled || stale;
  return (
    <section aria-label="AI-assisted authoring">
      <h2>AI-assisted authoring</h2>
      <p>Suggestions change the document only after you accept them.</p>
      {!settled ? (
        <p role="status">Save your changes before using AI authoring.</p>
      ) : null}
      {sources.error !== null ? <p role="alert">{describeError(sources.error)}</p> : null}
      {error !== null ? <p role="alert">{error}</p> : null}
      {attempt !== null && error !== null ? (
        <button type="button" onClick={onReload}>
          Load latest document
        </button>
      ) : null}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void generate();
        }}
      >
        <fieldset disabled={busy || suggestion !== null}>
          <legend>Authoring request</legend>
          <label>
            Operation{' '}
            <select
              value={kind}
              onChange={(event) => setKind(event.target.value as AuthoringKind)}
            >
              <option value="DRAFT">Draft section</option>
              <option value="REWRITE">Rewrite selection</option>
              <option value="EVIDENCE">Find evidence for claim</option>
            </select>
          </label>
          {kind === 'REWRITE' ? (
            <label>
              Rewrite action{' '}
              <select
                value={action}
                onChange={(event) => setAction(event.target.value as RewriteAction)}
              >
                {ACTIONS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {kind !== 'DRAFT' ? (
            <p>Selected text: {selection.text || 'Select prose in the editor.'}</p>
          ) : (
            <label>
              Insert section{' '}
              <select
                value={placement}
                onChange={(event) => setPlacement(event.target.value)}
              >
                <option value="selection">After current block</option>
                <option value="0">At the start</option>
                {Array.from({ length: blockCount }, (_, index) => (
                  <option key={index} value={index + 1}>
                    After block {index + 1}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Title or instruction{' '}
            <textarea
              maxLength={1000}
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
            />
          </label>
          {kind !== 'EVIDENCE' ? (
            <>
              <label>
                Length target (words){' '}
                <input
                  type="number"
                  min={20}
                  max={1000}
                  value={length}
                  onChange={(event) => setLength(Number(event.target.value))}
                />
              </label>
              <label>
                Style{' '}
                <select value={style} onChange={(event) => setStyle(event.target.value)}>
                  <option value="ACADEMIC">Academic</option>
                  <option value="CONCISE">Concise</option>
                  <option value="PLAIN">Plain language</option>
                </select>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={required}
                  onChange={(event) => setRequired(event.target.checked)}
                />
                Require citations for source-grounded output
              </label>
            </>
          ) : (
            <label>
              <input
                type="checkbox"
                checked={all}
                onChange={(event) => setAll(event.target.checked)}
              />
              Search all workspace sources
            </label>
          )}
          {kind !== 'REWRITE' || action === 'EXPAND' ? (
            <fieldset disabled={kind === 'EVIDENCE' && all}>
              <legend>
                {kind === 'REWRITE'
                  ? 'Optional sources for expansion'
                  : 'Selected sources'}
              </legend>
              {ready.map((source) => (
                <label key={source.id}>
                  <input
                    type="checkbox"
                    aria-label={source.displayName}
                    checked={selected.includes(source.id)}
                    onChange={(event) =>
                      setSelected((current) =>
                        event.target.checked
                          ? [...current, source.id]
                          : current.filter((id) => id !== source.id),
                      )
                    }
                  />
                  {source.displayName}{' '}
                  {source.sourceType ? (
                    <span aria-hidden="true">
                      <SourceTypeBadge sourceType={source.sourceType} />
                    </span>
                  ) : null}
                </label>
              ))}
              {ready.length === 0 ? <p>No ready sources available.</p> : null}
            </fieldset>
          ) : null}
          <button
            type="submit"
            disabled={!settled || sources.isPending || sources.error !== null}
          >
            Generate suggestion
          </button>
        </fieldset>
      </form>
      {busy ? <p role="status">Working on your request…</p> : null}
      {suggestion !== null ? (
        <section aria-label="AI suggestion">
          {stale ? (
            <p role="alert">
              The document changed. Reject this suggestion and generate a new one.
            </p>
          ) : null}
          {suggestion.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
          {suggestion.generation !== null ? (
            <p>
              Model: {suggestion.generation.model.name}; template:{' '}
              {suggestion.generation.templateId}
            </p>
          ) : null}
          {suggestion.command.kind === 'EVIDENCE' ? (
            <>
              {suggestion.candidates.length === 0 ? <p>Insufficient evidence.</p> : null}
              {suggestion.candidates.map((candidate) => (
                <article key={candidate.citation.chunkId}>
                  <p>
                    {candidate.category === 'related'
                      ? 'Related / partial'
                      : candidate.category}{' '}
                    — relevance {Math.round(candidate.relevance * 100)}%
                  </p>
                  <blockquote>{candidate.snippet}</blockquote>
                  <p>{candidate.reason}</p>
                  <Link to={citationPath(candidate.citation)}>
                    {candidate.citation.title ?? 'Source'} —{' '}
                    {candidate.citation.pageStart === null
                      ? (candidate.citation.sectionTitle ??
                        candidate.citation.spans[0]?.unitId ??
                        'location')
                      : `page ${candidate.citation.pageStart}`}
                  </Link>
                  <button
                    type="button"
                    disabled={
                      approvalBlocked ||
                      candidate.category === 'insufficient' ||
                      (attempt !== null &&
                        attempt.citationChunkId !== candidate.citation.chunkId)
                    }
                    onClick={() => void accept(candidate.citation.chunkId)}
                  >
                    Add citation
                  </button>
                </article>
              ))}
            </>
          ) : (
            <>
              <div aria-label="Suggestion diff" style={{ whiteSpace: 'pre-wrap' }}>
                {suggestion.originalText ? (
                  <p>
                    <del>{suggestion.originalText}</del>
                  </p>
                ) : null}
                <p>
                  <ins>{edited}</ins>
                </p>
              </div>
              {editing ? (
                <label>
                  Edit suggestion{' '}
                  <textarea
                    value={edited}
                    maxLength={12000}
                    disabled={busy || attempt !== null}
                    onChange={(event) => setEdited(event.target.value)}
                  />
                </label>
              ) : null}
              {suggestion.citations.map((citation) => (
                <p key={citation.chunkId}>
                  <Link to={citationPath(citation)}>
                    {citation.title ?? 'Source'} —{' '}
                    {citation.pageStart === null
                      ? (citation.sectionTitle ?? citation.spans[0]?.unitId ?? 'location')
                      : `page ${citation.pageStart}`}
                  </Link>
                </p>
              ))}
              <button
                type="button"
                disabled={approvalBlocked || !edited.trim()}
                onClick={() => void accept()}
              >
                {attempt === null ? 'Accept' : 'Retry acceptance'}
              </button>
              <button
                type="button"
                disabled={busy || attempt !== null || !suggestion.generatedText}
                onClick={() => setEditing(true)}
              >
                Edit
              </button>
            </>
          )}
          <button
            type="button"
            disabled={busy || attempt !== null}
            onClick={() => void reject()}
          >
            Reject
          </button>
        </section>
      ) : null}
    </section>
  );
}
