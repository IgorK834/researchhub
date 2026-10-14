import { t as uiText, useLocale as useUiLocale } from '../../../shared/i18n';
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
  get NO_RETRIEVED_EVIDENCE() {
    return uiText('ui.GroundedAnswer.message024');
  },
  get INSUFFICIENT_RETRIEVED_EVIDENCE() {
    return uiText('ui.GroundedAnswer.message025');
  },
};

/** Presentation only: never writes to a document or produces citations from streaming text. */
export function AnswerState({
  state,
  message,
  preview,
  onStop,
  onRetry,
  stopLabel = uiText('ui.GroundedAnswer.message022'),
  retryLabel = uiText('ui.AnalysisChart.message004'),
}: {
  readonly state: 'thinking' | 'streaming' | 'failed';
  readonly message: string;
  readonly preview?: string;
  readonly onStop?: () => void;
  readonly onRetry?: () => void;
  readonly stopLabel?: string;
  readonly retryLabel?: string;
}): ReactElement {
  useUiLocale();
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
        <p aria-label={uiText('ui.GroundedAnswer.message001')} aria-live="polite">
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
  useUiLocale();
  if (evidence.length === 0) return null;
  return (
    <Panel
      title={
        sourceView
          ? uiText('ui.GroundedAnswer.message002')
          : uiText('ui.GroundedAnswer.message003')
      }
    >
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
                {citation.title ??
                  citation.sectionTitle ??
                  uiText('ui.AiDraftBlock.message007')}
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
                  aria-label={uiText('ui.GroundedAnswer.message004', { value0: label })}
                >
                  {uiText('ui.GroundedAnswer.message005')}
                </Button>
                {sourceView ? (
                  <Button
                    href={citationPath(citation)}
                    variant="ghost"
                    size="compact"
                    icon="external"
                  >
                    {uiText('ui.GroundedAnswer.message006')}
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
  useUiLocale();
  const { model, usage } = generation.result;
  return (
    <details className={styles.provenance}>
      <summary>{uiText('ui.GroundedAnswer.message007')}</summary>
      <p>
        {model.provider === 'deterministic'
          ? uiText('ui.AiModeChip.message002')
          : uiText('ui.GroundedAnswer.message008', { value0: model.name })}{' '}
        ({model.version}) · {model.provider}
      </p>
      <p>
        {usage.estimated
          ? uiText('ui.GroundedAnswer.message009')
          : uiText('ui.GroundedAnswer.message010')}
        : {usage.totalTokens} {uiText('ui.GroundedAnswer.message011')} {usage.inputTokens}{' '}
        {uiText('ui.GroundedAnswer.message012')} {usage.outputTokens}
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
  useUiLocale();
  return (
    <section
      aria-label={uiText('ui.GroundedAnswer.message013')}
      className={styles.response}
    >
      {status === 'INSUFFICIENT_EVIDENCE' ? (
        <div className={styles.insufficient}>
          {reason === 'NO_RETRIEVED_EVIDENCE' &&
          evidence.length === 0 &&
          analysisEvidence.length === 0 ? (
            <Illustration scene="evidence" size="compact" />
          ) : null}
          <Banner tone="note" lead={uiText('ui.GroundedAnswer.message023')}>
            {reason === null || reason === undefined ? null : <p>{reasons[reason]}</p>}
            {answer ? <p>{answer}</p> : null}
            {insufficientAction}
          </Banner>
        </div>
      ) : (
        <Card className={styles.answer}>
          <h3>{uiText('ui.GroundedAnswer.message014')}</h3>
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
                          aria-label={uiText('ui.GroundedAnswer.message015', {
                            value0: label,
                          })}
                        >
                          [{label}]
                        </Link>
                      );
                    }
                    return (
                      <span key={id} role="alert">
                        {uiText('ui.GroundedAnswer.message016')}
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
                      label={uiText('ui.GroundedAnswer.message017', {
                        value0: String(index + 1),
                        value1: support.label || String(evidence.indexOf(support) + 1),
                      })}
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
        <Panel title={uiText('ui.AnalysisEvidencePicker.message002')}>
          <p>{uiText('ui.GroundedAnswer.message018')}</p>
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
                  {uiText('ui.AnalysisEvidencePicker.message004')} {citation.executionId}{' '}
                  · {citation.outputId} · {citation.executedAt}
                </p>
                <p>
                  {uiText('ui.GroundedAnswer.message019')}{' '}
                  {citation.inputSources
                    .map((input) => `${input.originalFilename} · v${input.versionNumber}`)
                    .join('; ')}
                </p>
                {citation.truncated ? (
                  <p>{uiText('ui.GroundedAnswer.message020')}</p>
                ) : null}
                <Link to={analysisCitationPath(citation)}>
                  {uiText('ui.GroundedAnswer.message021')}
                </Link>
              </li>
            ))}
          </ol>
        </Panel>
      ) : null}
      {generation === null ? null : <GenerationDetails generation={generation} />}
    </section>
  );
}
