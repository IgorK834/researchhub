import { t as uiText, useLocale as useUiLocale } from '../../../shared/i18n';
import { SourcePicker } from './SourcePicker';
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../../../shared/components/Button';
import { Icon } from '../../../shared/components/icons';
import { Illustration } from '../../../shared/components/Illustration';
import { AiDraftBlock } from './AiDraftBlock';
import { AiModeChip } from './AiModeChip';
import {
  authoringCommand,
  REWRITE_ACTIONS,
  type SelectionAuthoringRequest,
} from '../api/authoringActions';
import styles from './AuthoringPanel.module.css';
import { useQueryClient } from '@tanstack/react-query';
import { describeError, queryKeys } from '../../../shared/api';
import type { WorkspaceDocument } from '../../documents/api/documentApi';
import type { AuthoringSelection } from '../../documents/components/DocumentBodyEditor';
import { useSourcesQuery } from '../../sources/api/useSources';
import { AiSuggestionCard } from './AiSuggestionCard';
import { ClaimEvidencePanel } from './ClaimEvidencePanel';
import reviewStyles from './AuthoringReview.module.css';
import {
  acceptAuthoring,
  rejectAuthoring,
  suggestAuthoring,
  type AuthoringAcceptance,
  type AuthoringCommand,
  type AuthoringKind,
  type AuthoringSuggestion,
  type RewriteAction,
} from '../api/authoringApi';

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
  selectionRequest = null,
  draftHost,
  onDraftPlacementChange,
  onReviewing,
  onExplainSuggestion,
}: {
  readonly selectionRequest?: SelectionAuthoringRequest | null;
  readonly draftHost?: HTMLElement;
  readonly onDraftPlacementChange?: (
    placement: number | null,
    selectionEnd?: number,
  ) => void;
  readonly onReviewing?: (reviewing: boolean) => void;
  readonly onExplainSuggestion?: (suggestion: AuthoringSuggestion) => void;
  readonly workspaceId: string;
  readonly documentId: string;
  readonly revision: number;
  readonly settled: boolean;
  readonly selection: AuthoringSelection;
  readonly blockCount: number;
  readonly onBusy: (busy: boolean) => void;
  readonly onAccepted: (document: WorkspaceDocument, focusBlock?: number) => void;
  readonly onReload: () => void;
}): ReactElement {
  useUiLocale();
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
  const processedRequest = useRef<number | null>(null);
  const focusAfterAcceptance = useRef(false);
  const [generatingDraft, setGeneratingDraft] = useState(false);
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

  const generate = useCallback(
    async (request?: SelectionAuthoringRequest): Promise<void> => {
      if (inFlight.current || suggestion !== null) return;
      const requestKind =
        request === undefined
          ? kind
          : request.action === 'FIND_EVIDENCE'
            ? 'EVIDENCE'
            : 'REWRITE';
      const requestAction =
        request === undefined || request.action === 'FIND_EVIDENCE'
          ? action
          : request.action;
      const snapshot = request?.selection ?? selection;
      if (!settled || (request !== undefined && request.revision !== revision)) {
        setError(uiText('ui.AuthoringPanel.message046'));
        return;
      }
      if (sources.isPending || sources.error !== null) return;
      if (requestKind === 'DRAFT' && (selected.length === 0 || !instruction.trim())) {
        setError(uiText('ui.AuthoringPanel.message047'));
        return;
      }
      if (
        requestKind !== 'DRAFT' &&
        (snapshot.text.trim().length === 0 || snapshot.text.length > 2000)
      ) {
        setError(uiText('ui.AuthoringPanel.message048'));
        return;
      }
      const command = authoringCommand({
        kind: requestKind,
        action: requestAction,
        revision,
        selection: snapshot,
        placement,
        instruction,
        selected,
        all,
        length,
        style,
        required,
      });
      inFlight.current = true;
      setBusy(true);
      onBusy(true);
      setError(null);
      setKind(requestKind);
      setAction(requestAction);
      setGeneratingDraft(requestKind === 'DRAFT');
      onDraftPlacementChange?.(command.placementBlock);
      try {
        const result = await suggestAuthoring(workspaceId, documentId, command);
        setSuggestion(result);
        if (requestKind === 'REWRITE')
          onDraftPlacementChange?.(snapshot.placementBlock, snapshot.to);
        onReviewing?.(true);
        setEdited(result.generatedText);
        setEditing(false);
        setAttempt(null);
      } catch (failure) {
        setError(describeError(failure));
        onDraftPlacementChange?.(null);
      } finally {
        inFlight.current = false;
        setBusy(false);
        setGeneratingDraft(false);
        onBusy(false);
      }
    },
    [
      workspaceId,
      documentId,
      settled,
      revision,
      kind,
      action,
      selection,
      placement,
      instruction,
      selected,
      all,
      length,
      style,
      required,
      sources.isPending,
      sources.error,
      suggestion,
      onBusy,
      onDraftPlacementChange,
      onReviewing,
    ],
  );

  useEffect(() => {
    if (
      selectionRequest === null ||
      processedRequest.current === selectionRequest.id ||
      sources.isPending
    )
      return;
    processedRequest.current = selectionRequest.id;
    void generate(selectionRequest);
  }, [selectionRequest, sources.isPending, generate]);

  async function regenerate(): Promise<void> {
    if (suggestion === null || !settled || stale || attempt !== null || !begin()) return;
    const command: AuthoringCommand = suggestion.command;
    let rejected = false;
    setGeneratingDraft(true);
    try {
      await rejectAuthoring(workspaceId, documentId, suggestion.id);
      rejected = true;
      setSuggestion(null);
      onReviewing?.(false);
      const result = await suggestAuthoring(workspaceId, documentId, command);
      setSuggestion(result);
      onReviewing?.(true);
      setEdited(result.generatedText);
      setEditing(false);
    } catch (failure) {
      setError(describeError(failure));
      if (rejected) onDraftPlacementChange?.(null);
    } finally {
      setGeneratingDraft(false);
      end();
    }
  }
  async function reject(): Promise<void> {
    if (suggestion === null || !begin()) return;
    try {
      await rejectAuthoring(workspaceId, documentId, suggestion.id);
      setSuggestion(null);
      onReviewing?.(false);
      onDraftPlacementChange?.(null);
    } catch (failure) {
      setError(describeError(failure));
    } finally {
      end();
    }
  }
  async function accept(
    citationChunkId: string | null = null,
    insertAndEdit = false,
  ): Promise<void> {
    if (suggestion === null || !settled || stale || !begin()) return;
    const input = attempt ?? {
      expectedRevision: suggestion.command.expectedRevision,
      editedText: editing ? edited : null,
      citationChunkId,
    };
    if (attempt === null) focusAfterAcceptance.current = insertAndEdit;
    setAttempt(input);
    try {
      const result = await acceptAuthoring(workspaceId, documentId, suggestion.id, input);
      client.setQueryData(queryKeys.document(workspaceId, documentId), result.document);
      void client.invalidateQueries({
        queryKey: queryKeys.documentVersions(workspaceId, documentId),
      });
      void client.invalidateQueries({ queryKey: queryKeys.documents(workspaceId) });
      setSuggestion(null);
      onReviewing?.(false);
      onDraftPlacementChange?.(null);
      if (focusAfterAcceptance.current)
        onAccepted(result.document, suggestion.command.placementBlock ?? 0);
      else onAccepted(result.document);
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
  const draft = generatingDraft ? (
    <section
      className={styles.draft}
      aria-label={uiText('ui.AiDraftBlock.message001')}
      aria-busy="true"
    >
      <p role="status">{uiText('ui.AuthoringPanel.message001')}</p>
      <p>{uiText('ui.AuthoringPanel.message002')}</p>
    </section>
  ) : suggestion?.command.kind === 'DRAFT' ? (
    <AiDraftBlock
      suggestion={suggestion}
      sources={sources.data ?? []}
      busy={busy}
      blocked={approvalBlocked}
      retry={attempt !== null}
      onInsert={(edit) => void accept(null, edit)}
      onRegenerate={() => void regenerate()}
      onDiscard={() => void reject()}
    />
  ) : null;
  const sourceTypes = new Map(
    sources.data?.map((source) => [source.id, source.sourceType]),
  );
  const review =
    suggestion?.command.kind === 'REWRITE' ? (
      <AiSuggestionCard
        suggestion={suggestion}
        text={edited}
        editing={editing}
        blocked={approvalBlocked}
        frozen={attempt !== null}
        busy={busy}
        sourceTypes={sourceTypes}
        onTextChange={setEdited}
        onAccept={() => void accept()}
        onReject={() => void reject()}
        onEdit={() => setEditing(true)}
      />
    ) : (
      draft
    );
  const requestForm = (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        void generate();
      }}
    >
      <fieldset disabled={busy || suggestion !== null || !settled}>
        <legend>{uiText('ui.AuthoringPanel.message003')}</legend>
        <label>
          {uiText('ui.AuthoringPanel.message004')}{' '}
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value as AuthoringKind)}
          >
            <option value="DRAFT">{uiText('ui.AuthoringPanel.message005')}</option>
            <option value="REWRITE">{uiText('ui.AiSuggestionCard.message005')}</option>
            <option value="EVIDENCE">{uiText('ui.AuthoringPanel.message006')}</option>
          </select>
        </label>
        {kind === 'REWRITE' ? (
          <label>
            {uiText('ui.AuthoringPanel.message007')}{' '}
            <select
              value={action}
              onChange={(event) => setAction(event.target.value as RewriteAction)}
            >
              {REWRITE_ACTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {kind !== 'DRAFT' ? (
          <p>
            {uiText('ui.AuthoringPanel.message008')}{' '}
            {selection.text || uiText('ui.AuthoringPanel.message009')}
          </p>
        ) : (
          <label>
            {uiText('ui.AuthoringPanel.message010')}{' '}
            <select
              value={placement}
              onChange={(event) => setPlacement(event.target.value)}
            >
              <option value="selection">{uiText('ui.AuthoringPanel.message011')}</option>
              <option value="0">{uiText('ui.AuthoringPanel.message012')}</option>
              {Array.from({ length: blockCount }, (_, index) => (
                <option key={index} value={index + 1}>
                  {uiText('ui.AuthoringPanel.message013')} {index + 1}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          {uiText('ui.AuthoringPanel.message014')}{' '}
          <textarea
            maxLength={1000}
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
          />
        </label>
        {kind !== 'REWRITE' || action === 'EXPAND' ? (
          <SourcePicker
            legend={
              kind === 'REWRITE'
                ? uiText('ui.AuthoringPanel.message015')
                : uiText('ui.AuthoringPanel.message016')
            }
            action={uiText('ui.AuthoringPanel.message045')}
            sources={(sources.data ?? []).map((source) => ({
              id: source.id,
              title: source.displayName,
              sourceType: source.sourceType,
              status: source.status,
            }))}
            value={kind === 'EVIDENCE' && all ? null : selected}
            onChange={(ids) => {
              setSelected(ids);
              if (kind === 'EVIDENCE') setAll(false);
            }}
          />
        ) : null}
        {kind !== 'EVIDENCE' ? (
          <>
            <label>
              {uiText('ui.AuthoringPanel.message017')}{' '}
              <input
                type="range"
                aria-label={uiText('ui.AuthoringPanel.message017')}
                min={20}
                max={1000}
                value={length}
                aria-valuetext={`About ${length} words`}
                onChange={(event) => setLength(Number(event.target.value))}
              />
              <output>
                ~{length} {uiText('ui.AuthoringPanel.message018')}
              </output>
            </label>
            <label>
              {uiText('ui.AuthoringPanel.message019')}{' '}
              <select value={style} onChange={(event) => setStyle(event.target.value)}>
                <option value="ACADEMIC">{uiText('ui.AuthoringPanel.message020')}</option>
                <option value="CONCISE">{uiText('ui.AuthoringPanel.message021')}</option>
                <option value="PLAIN">{uiText('ui.AuthoringPanel.message022')}</option>
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={kind === 'DRAFT' || required}
                disabled={kind === 'DRAFT'}
                onChange={(event) => setRequired(event.target.checked)}
              />
              {uiText('ui.AuthoringPanel.message023')}
            </label>
          </>
        ) : (
          <label>
            <input
              type="checkbox"
              checked={all}
              onChange={(event) => setAll(event.target.checked)}
            />
            {uiText('ui.AuthoringPanel.message024')}
          </label>
        )}
        <Button
          icon="sparkle"
          type="submit"
          disabled={!settled || sources.isPending || sources.error !== null}
        >
          {kind === 'DRAFT'
            ? uiText('ui.AuthoringPanel.message025')
            : uiText('ui.AuthoringPanel.message026')}
        </Button>
      </fieldset>
    </form>
  );
  return (
    <section aria-label={uiText('ui.AuthoringPanel.message027')} className={styles.panel}>
      <AiModeChip />
      <h2>
        <Icon name="sparkle" />{' '}
        {kind === 'DRAFT'
          ? uiText('ui.AuthoringPanel.message028')
          : kind === 'EVIDENCE'
            ? uiText('ui.AuthoringPanel.message029')
            : REWRITE_ACTIONS.find(([value]) => value === action)?.[1]}
      </h2>
      <p>{uiText('ui.AuthoringPanel.message030')}</p>
      {suggestion === null &&
      !busy &&
      !sources.isPending &&
      sources.error === null &&
      error === null &&
      kind !== 'REWRITE' ? (
        <Illustration scene={kind === 'DRAFT' ? 'laptop' : 'magnifier'} size="compact" />
      ) : null}
      {!settled ? <p role="status">{uiText('ui.AuthoringPanel.message031')}</p> : null}
      {sources.error !== null ? <p role="alert">{describeError(sources.error)}</p> : null}
      {error !== null ? <p role="alert">{error}</p> : null}
      {attempt !== null && error !== null ? (
        <button type="button" onClick={onReload}>
          {uiText('ui.AuthoringPanel.message032')}
        </button>
      ) : null}
      {busy ? (
        <div>
          <Illustration scene="thinking" size="compact" />
          <p role="status">
            {generatingDraft
              ? uiText('ui.AuthoringPanel.message001')
              : uiText('ui.AuthoringPanel.message033')}
          </p>
        </div>
      ) : null}
      {suggestion?.command.kind === 'DRAFT' ? (
        <div className={styles.result} role="status">
          <strong>
            {suggestion.generatedText.trim() && suggestion.citations.length > 0
              ? uiText('ui.AuthoringPanel.message034', {
                  value0: suggestion.generatedText.trim().split(/\s+/).length,
                })
              : uiText('ui.AuthoringPanel.message035')}
          </strong>
          <p>
            {suggestion.citations.length} {uiText('ui.AuthoringPanel.message036')}
          </p>
        </div>
      ) : null}
      {kind === 'REWRITE' && action !== 'EXPAND' ? (
        <p>{uiText('ui.AuthoringPanel.message037')}</p>
      ) : null}
      {suggestion !== null && suggestion.command.kind !== 'DRAFT' ? (
        <details className={reviewStyles.settings}>
          <summary>{uiText('ui.AuthoringPanel.message038')}</summary>
          {requestForm}
        </details>
      ) : (
        requestForm
      )}
      {suggestion !== null && onExplainSuggestion ? (
        <Button
          variant="secondary"
          disabled={busy || !settled}
          onClick={() => onExplainSuggestion(suggestion)}
        >
          {uiText('ui.AuthoringPanel.message039')}
        </Button>
      ) : null}
      {draftHost === undefined ? review : createPortal(review, draftHost)}
      {suggestion?.command.kind === 'REWRITE' ? (
        <div className={reviewStyles.claim}>
          <span className={reviewStyles.eyebrow}>
            {uiText('ui.AuthoringPanel.message040')}
          </span>
          <blockquote>{suggestion.originalText}</blockquote>
          <p>{uiText('ui.AuthoringPanel.message041')}</p>
        </div>
      ) : null}
      {suggestion !== null && stale && suggestion.command.kind !== 'DRAFT' ? (
        <p role="alert">{uiText('ui.AuthoringPanel.message042')}</p>
      ) : null}
      {suggestion?.command.kind === 'EVIDENCE' ? (
        <ClaimEvidencePanel
          suggestion={suggestion}
          blocked={approvalBlocked}
          busy={busy}
          frozenChunkId={attempt?.citationChunkId ?? null}
          sourceTypes={sourceTypes}
          onAddCitation={(chunkId) => void accept(chunkId)}
          onReject={() => void reject()}
        />
      ) : null}
      {suggestion?.command.kind === 'DRAFT' && stale ? (
        <p role="alert">{uiText('ui.AuthoringPanel.message043')}</p>
      ) : null}
      <p className={styles.note}>{uiText('ui.AuthoringPanel.message044')}</p>
    </section>
  );
}
