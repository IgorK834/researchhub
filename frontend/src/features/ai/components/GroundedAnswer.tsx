import type { ReactElement, ReactNode } from 'react';
import { Button } from '../../../shared/components/Button';
import { Card, Panel } from '../../../shared/components/content';
import { Banner } from '../../../shared/components/feedback';
import { Illustration } from '../../../shared/components/Illustration';
import type { Citation, GeneratedResponse, AnalysisCitation } from '../api/generationApi';
import { analysisCitationPath } from '../api/generationApi';
import { Link } from 'react-router-dom';
import { citationPath } from '../api/generationApi';
import type { QuestionResponse } from '../api/questionApi';
import {
  CitationQuote,
  CitationReference,
  citationLocation,
  citationVariant,
} from './Citations';
import styles from './Research.module.css';

export interface AnswerEvidence {
  readonly citation: Citation;
  readonly label: string;
  readonly sourceType?: string;
}
const reasons: Record<NonNullable<QuestionResponse['reason']>, string> = {
  NO_RETRIEVED_EVIDENCE: 'No evidence was retrieved from the selected sources.',
  INSUFFICIENT_RETRIEVED_EVIDENCE:
    'The retrieved evidence is insufficient to answer this question.',
};

/** Presentation only: never writes to a document or produces citations from streaming text. */
export function AnswerState({
  state,
  message,
  preview,
  onStop,
  onRetry,
  stopLabel = 'Stop',
  retryLabel = 'Try again',
}: {
  readonly state: 'thinking' | 'streaming' | 'failed';
  readonly message: string;
  readonly preview?: string;
  readonly onStop?: () => void;
  readonly onRetry?: () => void;
  readonly stopLabel?: string;
  readonly retryLabel?: string;
}): ReactElement {
  if (state === 'failed')
    return (
      <div className={styles.failure}>
        <Banner tone="error" lead={message} />
        {onRetry === undefined ? null : (
          <Button variant="secondary" onClick={onRetry}>
            {retryLabel}
          </Button>
        )}
      </div>
    );
  return (
    <Card className={state === 'thinking' ? styles.answer : undefined}>
      {state === 'thinking' ? <Illustration scene="thinking" size="compact" /> : null}
      <p role="status" aria-live="polite">
        {message}
      </p>
      {state === 'streaming' ? (
        <p aria-label="Answer preview" aria-live="polite">
          {preview}
        </p>
      ) : null}
      {onStop === undefined ? null : (
        <Button variant="secondary" icon="x" onClick={onStop}>
          {stopLabel}
        </Button>
      )}
    </Card>
  );
}

export function EvidenceList<Support extends AnswerEvidence>({
  evidence,
  selected,
  onInspect,
  sourceView = false,
  fullLocation = true,
}: {
  readonly evidence: readonly Support[];
  readonly selected?: AnswerEvidence | null;
  readonly onInspect?: (evidence: Support) => void;
  readonly sourceView?: boolean;
  readonly fullLocation?: boolean;
}): ReactElement | null {
  if (evidence.length === 0) return null;
  return (
    <Panel title={sourceView ? 'Where it says so' : 'Evidence'}>
      <ol className={styles.evidence}>
        {evidence.map((support) => {
          const { citation, label } = support;
          const current =
            selected?.citation.chunkId === citation.chunkId &&
            selected.citation.processingVersion === citation.processingVersion;
          return (
            <li
              key={`${citation.sourceId}-${citation.processingVersion}-${citation.chunkId}`}
              data-selected={current || undefined}
            >
              <CitationReference
                citation={citation}
                number={label}
                variant={citationVariant(support.sourceType)}
                onInspect={onInspect === undefined ? undefined : () => onInspect(support)}
              >
                {label ? `[${label}] ` : ''}
                {citation.title ?? citation.sectionTitle ?? 'Source'}
                {!fullLocation && citation.pageStart === null
                  ? ''
                  : ` · ${citationLocation(citation)}`}
              </CitationReference>
              <p className={styles.evidenceLocation}>{citationLocation(citation)}</p>
              <CitationQuote citation={citation} />
              <div className={styles.actions}>
                <Button
                  href={citationPath(citation)}
                  variant="secondary"
                  size="compact"
                  icon="eye"
                  aria-label={`Inspect citation ${label}`}
                >
                  Inspect
                </Button>
                {sourceView ? (
                  <Button
                    href={citationPath(citation)}
                    variant="ghost"
                    size="compact"
                    icon="external"
                  >
                    Open page
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}

export function GenerationDetails({
  generation,
}: {
  readonly generation: GeneratedResponse;
}): ReactElement {
  const { model, usage } = generation.result;
  return (
    <details className={styles.provenance}>
      <summary>Generation details</summary>
      <p>
        Model: {model.name} ({model.version}) · {model.provider}
      </p>
      <p>
        {usage.estimated ? 'Estimated tokens' : 'Tokens'}: {usage.totalTokens} · Input:{' '}
        {usage.inputTokens} · Output: {usage.outputTokens}
      </p>
    </details>
  );
}

export function GroundedAnswer<Support extends AnswerEvidence>({
  status,
  answer,
  reason,
  generation,
  evidence,
  selected,
  onInspect,
  sourceView,
  insufficientAction,
  fullLocation,
  analysisEvidence = [],
}: {
  readonly status: QuestionResponse['status'];
  readonly answer?: string;
  readonly reason?: QuestionResponse['reason'];
  readonly generation: GeneratedResponse | null;
  readonly evidence: readonly Support[];
  readonly selected?: AnswerEvidence | null;
  readonly onInspect?: (evidence: Support) => void;
  readonly sourceView?: boolean;
  readonly insufficientAction?: ReactNode;
  readonly fullLocation?: boolean;
  readonly analysisEvidence?: readonly AnalysisCitation[];
}): ReactElement {
  return (
    <section aria-label="Source-grounded response" className={styles.response}>
      {status === 'INSUFFICIENT_EVIDENCE' ? (
        <div className={styles.insufficient}>
          {reason === 'NO_RETRIEVED_EVIDENCE' &&
          evidence.length === 0 &&
          analysisEvidence.length === 0 ? (
            <Illustration scene="evidence" size="compact" />
          ) : null}
          <Banner
            tone="note"
            lead="There is insufficient evidence to answer this request."
          >
            {reason === null || reason === undefined ? null : <p>{reasons[reason]}</p>}
            {answer ? <p>{answer}</p> : null}
            {insufficientAction}
          </Banner>
        </div>
      ) : (
        <Card className={styles.answer}>
          <h3>Grounded answer</h3>
          {generation === null ? (
            <p>{answer}</p>
          ) : (
            generation.result.answer.claims.map((claim, index) => (
              <p key={index}>
                {claim.text}{' '}
                {claim.evidenceIds.map((id) => {
                  const support = evidence.find((item) => item.citation.chunkId === id);
                  if (support === undefined) {
                    const computed = analysisEvidence.find(
                      (item) => item.evidenceId === id,
                    );
                    if (computed) {
                      const label =
                        generation.context?.citations.find(
                          (binding) => binding.chunkId === id,
                        )?.citationKey ?? `A${analysisEvidence.indexOf(computed) + 1}`;
                      return (
                        <Link
                          key={id}
                          to={analysisCitationPath(computed)}
                          className={styles.analysisCitation}
                          aria-label={`Open analysis evidence ${label}`}
                        >
                          [{label}]
                        </Link>
                      );
                    }
                    return (
                      <span key={id} role="alert">
                        Source reference is unavailable.
                      </span>
                    );
                  }
                  return (
                    <CitationReference
                      key={id}
                      inline
                      citation={support.citation}
                      number={support.label || evidence.indexOf(support) + 1}
                      variant={citationVariant(support.sourceType)}
                      label={`Show support for claim ${String(index + 1)}, ${support.label || String(evidence.indexOf(support) + 1)}`}
                      onInspect={
                        onInspect === undefined ? undefined : () => onInspect(support)
                      }
                    />
                  );
                })}
              </p>
            ))
          )}
        </Card>
      )}
      <EvidenceList
        evidence={evidence}
        selected={selected}
        onInspect={onInspect}
        sourceView={sourceView}
        fullLocation={fullLocation}
      />
      {analysisEvidence.length ? (
        <Panel title="Computed evidence">
          <p>
            Values were supplied from saved execution outputs. This answer did not run a
            new calculation.
          </p>
          <ol>
            {analysisEvidence.map((citation, index) => (
              <li key={citation.evidenceId}>
                <strong>
                  {generation?.context?.citations.find(
                    (binding) => binding.chunkId === citation.evidenceId,
                  )?.citationKey ?? `A${index + 1}`}{' '}
                  · {citation.title}
                </strong>
                <p>
                  Execution {citation.executionId} · {citation.outputId} ·{' '}
                  {citation.executedAt}
                </p>
                <p>
                  Inputs:{' '}
                  {citation.inputSources
                    .map((input) => `${input.originalFilename} · v${input.versionNumber}`)
                    .join('; ')}
                </p>
                {citation.truncated ? (
                  <p>
                    Only a bounded subset of saved rows was supplied. Missing rows and
                    statistics were not inferred.
                  </p>
                ) : null}
                <Link to={analysisCitationPath(citation)}>Open analysis provenance</Link>
              </li>
            ))}
          </ol>
        </Panel>
      ) : null}
      {generation === null ? null : <GenerationDetails generation={generation} />}
    </section>
  );
}
