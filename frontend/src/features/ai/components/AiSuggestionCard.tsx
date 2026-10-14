import { t as uiText, useLocale as useUiLocale } from '../../../shared/i18n';
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
  useUiLocale();
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (editing) input.current?.focus();
  }, [editing]);
  const cited = new Set(suggestion.citations.map((citation) => citation.sourceId)).size;
  const used =
    cited > 0
      ? `Uses your document text and ${cited} cited ${cited === 1 ? 'source' : 'sources'}.`
      : (suggestion.command.selectedSourceIds?.length ?? 0) > 0
        ? uiText('ui.AiSuggestionCard.message001')
        : uiText('ui.AiSuggestionCard.message002');
  return (
    <section
      aria-label={uiText('ui.AiSuggestionCard.message003')}
      className={styles.suggestion}
    >
      <header className={styles.heading}>
        <strong>
          <Icon name="sparkle" /> {uiText('ui.AiSuggestionCard.message004')}{' '}
          {REWRITE_ACTIONS.find(
            ([action]) => action === suggestion.command.action,
          )?.[1] ?? uiText('ui.AiSuggestionCard.message005')}
        </strong>
        <span className={styles.used}>{used}</span>
      </header>
      <div aria-label={uiText('ui.AiSuggestionCard.message006')} className={styles.diff}>
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
          <p role="status">{uiText('ui.AiSuggestionCard.message007')}</p>
        )}
      </div>
      {editing ? (
        <label className={styles.edit}>
          {uiText('ui.AiSuggestionCard.message008')}
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
        <div
          className={styles.citations}
          aria-label={uiText('ui.AiSuggestionCard.message009')}
        >
          {suggestion.citations.map((citation, index) => (
            <CitationReference
              key={citation.chunkId}
              citation={citation}
              number={index + 1}
              variant={citationVariant(sourceTypes.get(citation.sourceId))}
            >
              {citation.title ?? uiText('ui.AiDraftBlock.message007')} ·{' '}
              {citationLocation(citation)}
            </CitationReference>
          ))}
        </div>
      ) : null}
      {suggestion.warnings.map((warning) => (
        <p className={styles.note} key={warning}>
          {warning}
        </p>
      ))}
      <p className={styles.note}>{uiText('ui.AiSuggestionCard.message010')}</p>
      <div className={styles.actions}>
        <Button size="compact" disabled={blocked || !text.trim()} onClick={onAccept}>
          {frozen
            ? uiText('ui.AiDraftBlock.message011')
            : uiText('ui.AiSuggestionCard.message011')}
        </Button>
        <Button
          size="compact"
          variant="secondary"
          disabled={busy || frozen}
          onClick={onReject}
        >
          {uiText('ui.AiSuggestionCard.message012')}
        </Button>
        <Button
          size="compact"
          variant="ghost"
          disabled={blocked || frozen || !suggestion.generatedText}
          onClick={onEdit}
        >
          {uiText('ui.AiSuggestionCard.message013')}
        </Button>
      </div>
    </section>
  );
}
