import type { ReactElement } from 'react';
import { Button } from '../../../shared/components/Button';
import { Card, Panel } from '../../../shared/components/content';
import { SourceTypeTile, SourceTypeBadge } from '../../sources/components/SourceVisuals';
import { citationPath, type Citation } from '../api/generationApi';
import type { QuestionResponse } from '../api/questionApi';
import type { ResearchSources } from './ResearchPanel';
import { CitationQuote, citationLocation } from './Citations';
import { GroundedAnswer } from './GroundedAnswer';
import styles from './Research.module.css';
export { citationLocation, CitationQuote } from './Citations';
export interface SelectedCitation {
  readonly citation: Citation;
  readonly label: string;
  readonly sourceType: string;
}
export function CitationPanel({
  selected,
}: {
  readonly selected: SelectedCitation | null;
}): ReactElement {
  if (selected === null)
    return (
      <Panel title="Citation">
        <p>Select Inspect on an evidence card to see its source, location and quote.</p>
      </Panel>
    );
  const { citation, label, sourceType } = selected;
  return (
    <Panel title="Citation">
      <div className={styles.sourceHeading}>
        <SourceTypeTile sourceType={sourceType} />
        <div>
          <strong>{citation.title ?? 'Source'}</strong>
          <SourceTypeBadge sourceType={sourceType} />
        </div>
      </div>
      <Card className={styles.location}>
        <strong>{label}</strong>
        <span>{citationLocation(citation)}</span>
        {citation.sectionTitle !== null ? <span>{citation.sectionTitle}</span> : null}
      </Card>
      <CitationQuote citation={citation} />
      <Button href={citationPath(citation)} icon="external">
        Open source
      </Button>
    </Panel>
  );
}
export function ResearchAnswer({
  response,
  sources,
  selected,
  onInspect,
  sourceView,
  onAskAll,
  disabled,
}: {
  readonly response: QuestionResponse;
  readonly sources: ResearchSources;
  readonly selected: SelectedCitation | null;
  readonly onInspect: (citation: SelectedCitation) => void;
  readonly sourceView: boolean;
  readonly onAskAll: () => void;
  readonly disabled: boolean;
}): ReactElement {
  return (
    <GroundedAnswer
      status={response.status}
      answer={response.answer}
      reason={response.reason}
      generation={response.generation}
      evidence={response.citations.map((citation, index) => ({
        citation,
        label:
          response.generation?.context?.citations.find(
            (binding) => binding.chunkId === citation.chunkId,
          )?.citationKey ?? `S${String(index + 1)}`,
        sourceType:
          sources.sources.find((source) => source.id === citation.sourceId)?.sourceType ??
          'Source',
      }))}
      selected={selected}
      onInspect={onInspect}
      sourceView={sourceView}
      insufficientAction={
        sourceView ? (
          <Button variant="secondary" disabled={disabled} onClick={onAskAll}>
            Ask all sources instead
          </Button>
        ) : undefined
      }
    />
  );
}
