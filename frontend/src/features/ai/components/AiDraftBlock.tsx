import { t as uiText, useLocale as useUiLocale } from '../../../shared/i18n';
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
  useUiLocale();
  const grounded = new Set(suggestion.citations.map((citation) => citation.sourceId))
    .size;
  const ready = Boolean(suggestion.generatedText.trim()) && grounded > 0;
  return (
    <section aria-label={uiText('ui.AiDraftBlock.message001')} className={styles.draft}>
      <header className={styles.draftHeader}>
        <strong>
          <Icon name="sparkle" /> {uiText('ui.AiDraftBlock.message002')}
        </strong>
        <span className={styles.grounded}>
          {uiText('ui.AiDraftBlock.message003')} {grounded}{' '}
          {uiText('ui.AiDraftBlock.message004')}
        </span>
      </header>
      {ready ? (
        <div className={styles.draftText}>{suggestion.generatedText}</div>
      ) : (
        <p role="status">{uiText('ui.AiDraftBlock.message005')}</p>
      )}
      {suggestion.citations.length > 0 ? (
        <div
          className={styles.citations}
          aria-label={uiText('ui.AiDraftBlock.message006')}
        >
          {suggestion.citations.map((citation, index) => (
            <CitationReference
              key={citation.chunkId}
              citation={citation}
              number={index + 1}
              variant={citationVariant(
                sources.find((source) => source.id === citation.sourceId)?.sourceType,
              )}
            >
              {citation.title ?? uiText('ui.AiDraftBlock.message007')} —{' '}
              {citation.pageStart === null
                ? (citation.sectionTitle ??
                  citation.spans[0]?.unitId ??
                  uiText('ui.AiDraftBlock.message008'))
                : uiText('ui.AiDraftBlock.message009', { value0: citation.pageStart })}
            </CitationReference>
          ))}
        </div>
      ) : null}
      {suggestion.warnings.map((warning) => (
        <p key={warning} className={styles.warning}>
          {warning}
        </p>
      ))}
      <p className={styles.resultNote}>{uiText('ui.AiDraftBlock.message010')}</p>
      <div className={styles.actions}>
        <Button
          size="compact"
          disabled={blocked || !ready}
          onClick={() => onInsert(false)}
        >
          {retry
            ? uiText('ui.AiDraftBlock.message011')
            : uiText('ui.AiDraftBlock.message012')}
        </Button>
        <Button
          size="compact"
          variant="secondary"
          disabled={blocked || retry || !ready}
          onClick={() => onInsert(true)}
        >
          {uiText('ui.AiDraftBlock.message013')}
        </Button>
        <Button
          size="compact"
          variant="ghost"
          icon="refresh"
          disabled={blocked || retry}
          onClick={onRegenerate}
        >
          {uiText('ui.AiDraftBlock.message014')}
        </Button>
        <Button
          size="compact"
          variant="ghost"
          disabled={busy || retry}
          onClick={onDiscard}
        >
          {uiText('ui.AiDraftBlock.message015')}
        </Button>
      </div>
    </section>
  );
}
