import { useEffect, useRef, type ReactElement } from 'react';
import type { AuthoringSuggestion } from '../api/authoringApi';
import { REWRITE_ACTIONS } from '../api/authoringActions';
import { Button } from '../../../shared/components/Button';
import { Icon } from '../../../shared/components/icons';
import { CitationReference, citationLocation, citationVariant } from './Citations';
import styles from './AuthoringReview.module.css';

/** Presentation only: the parent owns the saved proposal, revision guard and approval retry. */
export function AiSuggestionCard({
  suggestion,
  text,
  editing,
  blocked,
  frozen,
  busy,
  sourceTypes,
  onTextChange,
  onAccept,
  onReject,
  onEdit,
}: {
  readonly suggestion: AuthoringSuggestion;
  readonly text: string;
  readonly editing: boolean;
  readonly blocked: boolean;
  readonly frozen: boolean;
  readonly busy: boolean;
  readonly sourceTypes: ReadonlyMap<string, string>;
  readonly onTextChange: (text: string) => void;
  readonly onAccept: () => void;
  readonly onReject: () => void;
  readonly onEdit: () => void;
}): ReactElement {
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (editing) input.current?.focus();
  }, [editing]);
  const cited = new Set(suggestion.citations.map((citation) => citation.sourceId)).size;
  const used =
    cited > 0
      ? `Uses your document text and ${cited} cited ${cited === 1 ? 'source' : 'sources'}.`
      : (suggestion.command.selectedSourceIds?.length ?? 0) > 0
        ? 'Uses your document text; no source citations were returned.'
        : 'Uses only your document text.';
  return (
    <section aria-label="AI suggestion" className={styles.suggestion}>
      <header className={styles.heading}>
        <strong>
          <Icon name="sparkle" /> Suggestion ·{' '}
          {REWRITE_ACTIONS.find(
            ([action]) => action === suggestion.command.action,
          )?.[1] ?? 'Rewrite selection'}
        </strong>
        <span className={styles.used}>{used}</span>
      </header>
      <div aria-label="Suggestion diff" className={styles.diff}>
        {suggestion.originalText ? (
          <p>
            <del>{suggestion.originalText}</del>
          </p>
        ) : null}
        {text ? (
          <p>
            <ins>{text}</ins>
          </p>
        ) : (
          <p role="status">
            No replacement text was returned. Keep your text or try another request.
          </p>
        )}
      </div>
      {editing ? (
        <label className={styles.edit}>
          Edit suggestion
          <textarea
            ref={input}
            value={text}
            maxLength={12000}
            disabled={blocked || frozen}
            onChange={(event) => onTextChange(event.target.value)}
          />
        </label>
      ) : null}
      {suggestion.citations.length > 0 ? (
        <div className={styles.citations} aria-label="Suggestion sources">
          {suggestion.citations.map((citation, index) => (
            <CitationReference
              key={citation.chunkId}
              citation={citation}
              number={index + 1}
              variant={citationVariant(sourceTypes.get(citation.sourceId))}
            >
              {citation.title ?? 'Source'} · {citationLocation(citation)}
            </CitationReference>
          ))}
        </div>
      ) : null}
      {suggestion.warnings.map((warning) => (
        <p className={styles.note} key={warning}>
          {warning}
        </p>
      ))}
      <p className={styles.note}>
        Your document is unchanged until you accept this suggestion.
      </p>
      <div className={styles.actions}>
        <Button size="compact" disabled={blocked || !text.trim()} onClick={onAccept}>
          {frozen ? 'Retry acceptance' : 'Accept'}
        </Button>
        <Button
          size="compact"
          variant="secondary"
          disabled={busy || frozen}
          onClick={onReject}
        >
          Reject
        </Button>
        <Button
          size="compact"
          variant="ghost"
          disabled={blocked || frozen || !suggestion.generatedText}
          onClick={onEdit}
        >
          Edit
        </Button>
      </div>
    </section>
  );
}
