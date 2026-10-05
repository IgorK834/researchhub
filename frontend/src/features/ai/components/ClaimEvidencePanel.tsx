import type { ReactElement } from 'react';
import type { AuthoringSuggestion } from '../api/authoringApi';
import { citationPath } from '../api/generationApi';
import { Button } from '../../../shared/components/Button';
import { CitationReference, citationLocation, citationVariant } from './Citations';
import styles from './AuthoringReview.module.css';

const categories = {
  supporting: 'Supporting evidence',
  related: 'Related / partial evidence',
  insufficient: 'Insufficient evidence',
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
  const noEvidence = !suggestion.candidates.some(
    (candidate) => candidate.category !== 'insufficient',
  );
  return (
    <section aria-label="AI suggestion" className={styles.evidencePanel}>
      <div className={styles.claim}>
        <span className={styles.eyebrow}>Claim</span>
        <blockquote>{suggestion.originalText}</blockquote>
      </div>
      <p className={styles.note}>
        Review the source passage in context before adding a citation. Your claim stays
        unchanged.
      </p>
      {noEvidence ? (
        <div className={styles.noEvidence} role="status">
          <strong>No supporting evidence found.</strong>
          <p>
            The returned excerpts do not support this claim. You can keep the claim as it
            is.
          </p>
          <Button
            variant="secondary"
            size="compact"
            disabled={busy || frozenChunkId !== null}
            onClick={onReject}
          >
            Keep claim as it is
          </Button>
        </div>
      ) : null}
      {suggestion.candidates.map((candidate, index) => (
        <article
          key={candidate.citation.chunkId}
          className={styles.evidenceCard}
          aria-label={`Evidence ${index + 1}`}
        >
          <div className={styles.heading}>
            <strong>{candidate.citation.title ?? 'Source'}</strong>
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
              label={`Inspect evidence ${index + 1}: ${candidate.citation.title ?? 'Source'}`}
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
                ? 'Retry citation'
                : 'Add citation'}
            </Button>
            <Button
              href={citationPath(candidate.citation)}
              target="_blank"
              rel="noopener noreferrer"
              title="Open source in a new tab"
              size="compact"
              variant="ghost"
              icon="external"
            >
              Open
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
          Reject
        </Button>
      ) : null}
    </section>
  );
}
