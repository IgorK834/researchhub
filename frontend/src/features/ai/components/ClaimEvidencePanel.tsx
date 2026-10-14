import { t as uiText, useLocale as useUiLocale } from '../../../shared/i18n';
import type { ReactElement } from 'react';
import type { AuthoringSuggestion } from '../api/authoringApi';
import { citationPath } from '../api/generationApi';
import { Button } from '../../../shared/components/Button';
import { Illustration } from '../../../shared/components/Illustration';
import { CitationReference, citationLocation, citationVariant } from './Citations';
import styles from './AuthoringReview.module.css';

const categories = {
  get supporting() {
    return uiText('ui.ClaimEvidencePanel.message012');
  },
  get related() {
    return uiText('ui.ClaimEvidencePanel.message013');
  },
  get insufficient() {
    return uiText('ui.AuthoringPanel.message035');
  },
};

export function ClaimEvidencePanel({
  suggestion,
  blocked,
  frozenChunkId,
  busy,
  sourceTypes,
  onAddCitation,
  onReject,
}: {
  readonly suggestion: AuthoringSuggestion;
  readonly blocked: boolean;
  readonly frozenChunkId: string | null;
  readonly busy: boolean;
  readonly sourceTypes: ReadonlyMap<string, string>;
  readonly onAddCitation: (chunkId: string) => void;
  readonly onReject: () => void;
}): ReactElement {
  useUiLocale();
  const noEvidence = !suggestion.candidates.some(
    (candidate) => candidate.category !== 'insufficient',
  );
  return (
    <section
      aria-label={uiText('ui.AiSuggestionCard.message003')}
      className={styles.evidencePanel}
    >
      <div className={styles.claim}>
        <span className={styles.eyebrow}>
          {uiText('ui.ClaimEvidencePanel.message001')}
        </span>
        <blockquote>{suggestion.originalText}</blockquote>
      </div>
      <p className={styles.note}>{uiText('ui.ClaimEvidencePanel.message002')}</p>
      {noEvidence ? (
        <div className={styles.noEvidence} role="status">
          <Illustration scene="evidence" size="compact" />
          <strong>{uiText('ui.ClaimEvidencePanel.message003')}</strong>
          <p>{uiText('ui.ClaimEvidencePanel.message004')}</p>
          <Button
            variant="secondary"
            size="compact"
            disabled={busy || frozenChunkId !== null}
            onClick={onReject}
          >
            {uiText('ui.ClaimEvidencePanel.message005')}
          </Button>
        </div>
      ) : null}
      {suggestion.candidates.map((candidate, index) => (
        <article
          key={candidate.citation.chunkId}
          className={styles.evidenceCard}
          aria-label={uiText('ui.ClaimEvidencePanel.message006', { value0: index + 1 })}
        >
          <div className={styles.heading}>
            <strong>
              {candidate.citation.title ?? uiText('ui.AiDraftBlock.message007')}
            </strong>
            <span className={styles.category} data-category={candidate.category}>
              {categories[candidate.category]}
            </span>
          </div>
          <p className={styles.location}>
            {citationLocation(candidate.citation)}
            {candidate.citation.pageStart !== null &&
            candidate.citation.sectionTitle !== null
              ? ` · ${candidate.citation.sectionTitle}`
              : ''}
          </p>
          <blockquote className={styles.quote}>{candidate.snippet}</blockquote>
          {candidate.reason ? <p className={styles.note}>{candidate.reason}</p> : null}
          <div className={styles.citations}>
            <CitationReference
              citation={candidate.citation}
              number={index + 1}
              quote={candidate.snippet}
              variant={citationVariant(sourceTypes.get(candidate.citation.sourceId))}
              label={uiText('ui.ClaimEvidencePanel.message007', {
                value0: index + 1,
                value1: candidate.citation.title ?? uiText('ui.AiDraftBlock.message007'),
              })}
            />
          </div>
          <div className={styles.actions}>
            <Button
              size="compact"
              disabled={
                blocked ||
                candidate.category === 'insufficient' ||
                (frozenChunkId !== null && frozenChunkId !== candidate.citation.chunkId)
              }
              onClick={() => onAddCitation(candidate.citation.chunkId)}
            >
              {frozenChunkId === candidate.citation.chunkId
                ? uiText('ui.ClaimEvidencePanel.message008')
                : uiText('ui.ClaimEvidencePanel.message009')}
            </Button>
            <Button
              href={citationPath(candidate.citation)}
              target="_blank"
              rel="noopener noreferrer"
              title={uiText('ui.ClaimEvidencePanel.message010')}
              size="compact"
              variant="ghost"
              icon="external"
            >
              {uiText('ui.ClaimEvidencePanel.message011')}
            </Button>
          </div>
        </article>
      ))}
      {suggestion.warnings.map((warning) => (
        <p key={warning} className={styles.note}>
          {warning}
        </p>
      ))}
      {!noEvidence ? (
        <Button
          variant="secondary"
          size="compact"
          disabled={busy || frozenChunkId !== null}
          onClick={onReject}
        >
          {uiText('ui.AiSuggestionCard.message012')}
        </Button>
      ) : null}
    </section>
  );
}
