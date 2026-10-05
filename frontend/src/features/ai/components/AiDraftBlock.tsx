import type { ReactElement } from 'react';
import type { AuthoringSuggestion } from '../api/authoringApi';
import { CitationReference, citationVariant } from './Citations';
import { Button } from '../../../shared/components/Button';
import { Icon } from '../../../shared/components/icons';
import styles from './AuthoringPanel.module.css';

export function AiDraftBlock({
  suggestion,
  sources,
  busy,
  blocked,
  retry,
  onInsert,
  onRegenerate,
  onDiscard,
}: {
  readonly suggestion: Pick<
    AuthoringSuggestion,
    'generatedText' | 'citations' | 'warnings'
  >;
  readonly sources: readonly { readonly id: string; readonly sourceType: string }[];
  readonly busy: boolean;
  readonly blocked: boolean;
  readonly retry: boolean;
  readonly onInsert: (edit: boolean) => void;
  readonly onRegenerate: () => void;
  readonly onDiscard: () => void;
}): ReactElement {
  const grounded = new Set(suggestion.citations.map((citation) => citation.sourceId))
    .size;
  const ready = Boolean(suggestion.generatedText.trim()) && grounded > 0;
  return (
    <section aria-label="AI draft" className={styles.draft}>
      <header className={styles.draftHeader}>
        <strong>
          <Icon name="sparkle" /> AI draft — not in your document yet
        </strong>
        <span className={styles.grounded}>Grounded in {grounded} sources</span>
      </header>
      {ready ? (
        <div className={styles.draftText}>{suggestion.generatedText}</div>
      ) : (
        <p role="status">
          Insufficient evidence. Choose additional ready sources or refine the instruction
          and generate a new draft.
        </p>
      )}
      {suggestion.citations.length > 0 ? (
        <div className={styles.citations} aria-label="Draft sources">
          {suggestion.citations.map((citation, index) => (
            <CitationReference
              key={citation.chunkId}
              citation={citation}
              number={index + 1}
              variant={citationVariant(
                sources.find((source) => source.id === citation.sourceId)?.sourceType,
              )}
            >
              {citation.title ?? 'Source'} —{' '}
              {citation.pageStart === null
                ? (citation.sectionTitle ?? citation.spans[0]?.unitId ?? 'location')
                : `page ${citation.pageStart}`}
            </CitationReference>
          ))}
        </div>
      ) : null}
      {suggestion.warnings.map((warning) => (
        <p key={warning} className={styles.warning}>
          {warning}
        </p>
      ))}
      <p className={styles.resultNote}>
        This draft is a suggestion; your document is unchanged.
      </p>
      <div className={styles.actions}>
        <Button
          size="compact"
          disabled={blocked || !ready}
          onClick={() => onInsert(false)}
        >
          {retry ? 'Retry acceptance' : 'Insert draft'}
        </Button>
        <Button
          size="compact"
          variant="secondary"
          disabled={blocked || retry || !ready}
          onClick={() => onInsert(true)}
        >
          Insert and edit
        </Button>
        <Button
          size="compact"
          variant="ghost"
          icon="refresh"
          disabled={blocked || retry}
          onClick={onRegenerate}
        >
          Regenerate
        </Button>
        <Button
          size="compact"
          variant="ghost"
          disabled={busy || retry}
          onClick={onDiscard}
        >
          Discard
        </Button>
      </div>
    </section>
  );
}
