import { t as uiText, useLocale as useUiLocale } from '../../../shared/i18n';
import { CreateReviewTaskButton } from '../../review-tasks/TaskComposer';
import { SourcePicker } from './SourcePicker';
import { useRef, useState, type ReactElement } from 'react';
import { useMutation } from '@tanstack/react-query';
import { describeError } from '../../../shared/api';
import { useSourcesQuery } from '../../sources/api/useSources';
import { CitationReference, citationLocation } from './Citations';
import { citationPath } from '../api/generationApi';
import { Button } from '../../../shared/components/Button';
import { Illustration } from '../../../shared/components/Illustration';
import { Icon } from '../../../shared/components/icons';
import { AiModeChip } from './AiModeChip';
import styles from './SourceComparisonPanel.module.css';
import {
  compareSources,
  findPotentialDisagreements,
  DEFAULT_COMPARISON_CRITERIA,
  type ComparisonCommand,
  type SourceAnalysis,
  type VersionSelection,
} from '../api/sourceAnalysisApi';

export function SourceComparisonPanel({
  workspaceId,
}: {
  readonly workspaceId: string;
}): ReactElement {
  return <ComparisonForm key={workspaceId} workspaceId={workspaceId} />;
}
function ComparisonForm({ workspaceId }: { readonly workspaceId: string }): ReactElement {
  useUiLocale();
  const sources = useSourcesQuery(workspaceId);
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [picking, setPicking] = useState(false);
  const inFlight = useRef(false);
  const [criteria, setCriteria] = useState<string>(
    DEFAULT_COMPARISON_CRITERIA.join('\n'),
  );
  const [instruction, setInstruction] = useState('');
  const [focus, setFocus] = useState('');
  const [versionSelection, setVersionSelection] = useState<VersionSelection>('ORIGINAL');
  const [validation, setValidation] = useState<string | null>(null);
  const compare = useMutation({
    mutationFn: (command: ComparisonCommand) => compareSources(workspaceId, command),
  });
  const differences = useMutation({
    mutationFn: ({
      id,
      instruction: detail,
      versions,
    }: {
      id: string;
      instruction: string | null;
      versions: VersionSelection;
    }) => findPotentialDisagreements(workspaceId, id, detail, versions),
  });
  const busy = compare.isPending || differences.isPending;
  return (
    <section aria-labelledby="source-comparison-heading" className={styles.panel}>
      <h2 id="source-comparison-heading">
        <Icon name="columns" /> {uiText('ui.SourceComparisonPanel.message001')}
      </h2>
      <p>{uiText('ui.SourceComparisonPanel.message002')}</p>
      {sources.isPending ? (
        <p role="status">{uiText('ui.SourceComparisonPanel.message003')}</p>
      ) : null}
      {sources.error !== null ? (
        <p role="alert">
          {uiText('ui.SourceComparisonPanel.message004')} {describeError(sources.error)}
        </p>
      ) : null}
      <div
        className={styles.selected}
        aria-label={uiText('ui.SourceComparisonPanel.message005')}
      >
        <span>{uiText('ui.SourceComparisonPanel.message006')}</span>
        {selected.map((id) => (
          <span key={id} className={styles.sourceChip}>
            {sources.data?.find((source) => source.id === id)?.displayName ??
              uiText('ui.SourceComparisonPanel.message007')}
            <Button
              iconOnly
              icon="x"
              size="compact"
              variant="ghost"
              aria-label={uiText('ui.SourceComparisonPanel.message008', {
                value0:
                  sources.data?.find((source) => source.id === id)?.displayName ??
                  uiText('ui.SourceComparisonPanel.message009'),
              })}
              disabled={busy}
              onClick={() => {
                setSelected(selected.filter((item) => item !== id));
                setValidation(null);
                compare.reset();
                differences.reset();
              }}
            />
          </span>
        ))}
        <Button
          className={styles.addSource}
          icon="plus"
          variant="secondary"
          size="compact"
          disabled={
            busy || sources.isPending || sources.error !== null || selected.length >= 5
          }
          aria-expanded={picking}
          aria-controls="comparison-source-picker"
          onClick={() => setPicking(!picking)}
        >
          {uiText('ui.SourceComparisonPanel.message010')}
        </Button>
        <span className={styles.note}>
          {selected.length} {uiText('ui.SourceComparisonPanel.message011')}
        </span>
      </div>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          if (inFlight.current || sources.isPending || sources.error !== null) return;
          const fields = criteria
            .split('\n')
            .map((field) => field.trim())
            .filter(Boolean);
          if (
            selected.length < 2 ||
            selected.length > 5 ||
            selected.some(
              (id) => !sources.data?.some((s) => s.id === id && s.status === 'READY'),
            )
          ) {
            setValidation(uiText('ui.SourceComparisonPanel.message051'));
            return;
          }
          if (
            fields.length < 1 ||
            fields.length > 5 ||
            fields.some((field) => field.length > 64) ||
            new Set(fields.map((field) => field.toLowerCase())).size !== fields.length
          ) {
            setValidation(uiText('ui.SourceComparisonPanel.message052'));
            return;
          }
          setValidation(null);
          differences.reset();
          setVersionSelection('ORIGINAL');
          setPicking(false);
          inFlight.current = true;
          compare.mutate(
            {
              selectedSourceIds: selected,
              criteria: fields,
              instruction: instruction.trim() || null,
            },
            {
              onSettled: () => {
                inFlight.current = false;
              },
            },
          );
        }}
      >
        <fieldset disabled={busy || sources.isPending || sources.error !== null}>
          <legend>{uiText('ui.SourceComparisonPanel.message012')}</legend>
          {picking ? (
            <div id="comparison-source-picker" className={styles.picker}>
              <SourcePicker
                legend={uiText('ui.SourceComparisonPanel.message049')}
                action={uiText('ui.SourceComparisonPanel.message050')}
                sources={(sources.data ?? []).map((source) => ({
                  id: source.id,
                  title: source.displayName,
                  sourceType: source.sourceType,
                  status: source.status,
                }))}
                value={selected}
                maxSelected={5}
                onChange={(ids) => {
                  setSelected(ids);
                  setValidation(null);
                  compare.reset();
                  differences.reset();
                }}
              />
              <Button
                variant="secondary"
                size="compact"
                onClick={() => setPicking(false)}
              >
                {uiText('ui.SourceComparisonPanel.message013')}
              </Button>
            </div>
          ) : null}
          {!sources.isPending && sources.error === null && sources.data?.length === 0 ? (
            <div>
              <Illustration scene="sources" size="compact" />
              <p>{uiText('ui.SourceComparisonPanel.message014')}</p>
            </div>
          ) : null}
          <details className={styles.settings} open={compare.data === undefined}>
            <summary>{uiText('ui.SourceComparisonPanel.message015')}</summary>
            <label>
              {uiText('ui.SourceComparisonPanel.message016')}
              <textarea
                maxLength={324}
                value={criteria}
                onChange={(event) => setCriteria(event.target.value)}
              />
            </label>
            <label>
              {uiText('ui.SourceComparisonPanel.message017')}
              <textarea
                maxLength={1000}
                value={instruction}
                onChange={(event) => setInstruction(event.target.value)}
              />
            </label>
          </details>
          <Button
            icon="columns"
            type="submit"
            busy={compare.isPending}
            busyLabel={uiText('ui.SourceComparisonPanel.message018')}
          >
            {uiText('ui.SourceComparisonPanel.message019')}
          </Button>
        </fieldset>
      </form>
      {validation === null ? null : <p role="alert">{validation}</p>}
      {compare.error === null ? null : (
        <p role="alert">
          {uiText('ui.SourceComparisonPanel.message020')} {describeError(compare.error)}
        </p>
      )}
      {compare.data !== undefined && !compare.isPending ? (
        <>
          <ComparisonResult analysis={compare.data} />
          <section
            className={styles.differencesCard}
            aria-label={uiText('ui.SourceComparisonPanel.message021')}
          >
            <h3>
              <Icon name="warn" /> {uiText('ui.SourceComparisonPanel.message021')}
            </h3>
            <p>{uiText('ui.SourceComparisonPanel.message022')}</p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (compare.data !== undefined && !inFlight.current) {
                  inFlight.current = true;
                  differences.mutate(
                    {
                      id: compare.data.id,
                      instruction: focus.trim() || null,
                      versions: versionSelection,
                    },
                    {
                      onSettled: () => {
                        inFlight.current = false;
                      },
                    },
                  );
                }
              }}
            >
              <VersionChoice
                analysis={compare.data}
                currentVersionIds={
                  new Map(
                    sources.data?.map((source) => [source.id, source.activeVersionId]),
                  )
                }
                value={versionSelection}
                disabled={busy}
                onChange={setVersionSelection}
              />
              <label>
                {uiText('ui.SourceComparisonPanel.message023')}
                <textarea
                  disabled={busy}
                  maxLength={1000}
                  value={focus}
                  onChange={(event) => setFocus(event.target.value)}
                />
              </label>
              <Button
                type="submit"
                disabled={busy}
                busy={differences.isPending}
                busyLabel={uiText('ui.SourceComparisonPanel.message024')}
              >
                {uiText('ui.SourceComparisonPanel.message025')}
              </Button>
            </form>
          </section>
        </>
      ) : null}
      {differences.error === null ? null : (
        <p role="alert">
          {uiText('ui.SourceComparisonPanel.message026')}{' '}
          {describeError(differences.error)}
        </p>
      )}
      {differences.data !== undefined && !differences.isPending ? (
        <DisagreementResult analysis={differences.data} />
      ) : null}
    </section>
  );
}
/**
 * Re-running an analysis keeps the exact source versions it consumed unless the user explicitly migrates it, so a
 * replaced spreadsheet or paper never silently changes what an earlier result was based on.
 */
function VersionChoice({
  analysis,
  currentVersionIds,
  value,
  disabled,
  onChange,
}: {
  readonly analysis: SourceAnalysis;
  readonly currentVersionIds: ReadonlyMap<string, string>;
  readonly value: VersionSelection;
  readonly disabled: boolean;
  readonly onChange: (value: VersionSelection) => void;
}): ReactElement {
  useUiLocale();
  const newer = analysis.sources.filter((source) => {
    const current = currentVersionIds.get(source.id);
    return (
      source.sourceVersionId !== null &&
      current !== undefined &&
      current !== source.sourceVersionId
    );
  });
  return (
    <fieldset disabled={disabled} className={styles.versions}>
      <legend>{uiText('ui.SourceComparisonPanel.message027')}</legend>
      {newer.length === 0 ? null : (
        <p role="status">
          {uiText('ui.SourceComparisonPanel.message028')}{' '}
          {newer.map((source) => source.title).join(', ')}.
        </p>
      )}
      <label>
        <input
          type="radio"
          name="source-version-selection"
          value="ORIGINAL"
          checked={value === 'ORIGINAL'}
          onChange={() => onChange('ORIGINAL')}
        />
        {uiText('ui.SourceComparisonPanel.message029')}
      </label>
      <label>
        <input
          type="radio"
          name="source-version-selection"
          value="LATEST"
          checked={value === 'LATEST'}
          onChange={() => onChange('LATEST')}
        />
        {uiText('ui.SourceComparisonPanel.message030')}
      </label>
    </fieldset>
  );
}
function EvidenceLinks({
  ids,
  analysis,
}: {
  readonly ids: readonly string[];
  readonly analysis: SourceAnalysis;
}): ReactElement {
  useUiLocale();
  return (
    <span className={styles.citations}>
      {ids.map((id) => {
        const citation = analysis.evidence.find((item) => item.chunkId === id);
        if (citation === undefined)
          return (
            <span key={id} className={styles.missing}>
              {uiText('ui.SourceComparisonPanel.message031')}
            </span>
          );
        return (
          <CitationReference
            key={id}
            citation={citation}
            number={analysis.evidence.indexOf(citation) + 1}
            label={`${citation.title ?? uiText('ui.AiDraftBlock.message007')} · ${citationLocation(citation)}`}
          >
            {citation.pageStart !== null
              ? `p. ${citation.pageStart}${citation.pageEnd !== null && citation.pageEnd !== citation.pageStart ? `–${citation.pageEnd}` : ''}`
              : (citation.sectionTitle ?? uiText('ui.Citations.message001'))}
          </CitationReference>
        );
      })}
    </span>
  );
}
function Provenance({ analysis }: { readonly analysis: SourceAnalysis }): ReactElement {
  return (
    <>
      {analysis.warnings.map((warning) => (
        <p key={warning}>{warning}</p>
      ))}
      {analysis.generation === null ? null : (
        <AiModeChip
          ai={
            analysis.generation.model.provider === 'deterministic'
              ? { mode: 'deterministic', modelName: null }
              : { mode: 'live', modelName: analysis.generation.model.name }
          }
        />
      )}
    </>
  );
}
export function ComparisonResult({
  analysis,
}: {
  readonly analysis: SourceAnalysis;
}): ReactElement {
  useUiLocale();
  return (
    <section
      aria-label={uiText('ui.SourceComparisonPanel.message032')}
      className={styles.result}
    >
      <h3 className="visually-hidden">{uiText('ui.SourceComparisonPanel.message033')}</h3>
      <Provenance analysis={analysis} />
      {analysis.answer.status === 'INSUFFICIENT_EVIDENCE' ? (
        <p>{uiText('ui.SourceComparisonPanel.message034')}</p>
      ) : null}
      <div
        className={styles.grid}
        role="region"
        aria-label={uiText('ui.SourceComparisonPanel.message035')}
        tabIndex={0}
      >
        <table>
          <caption>{uiText('ui.SourceComparisonPanel.message036')}</caption>
          <thead>
            <tr>
              <th scope="col">{uiText('ui.SourceComparisonPanel.message037')}</th>
              {analysis.sources.map((source) => {
                const citation = analysis.evidence.find(
                  (item) => item.sourceId === source.id,
                );
                return (
                  <th scope="col" key={source.id}>
                    <span>
                      {source.title}
                      {source.versionNumber > 0
                        ? ' ' +
                          uiText('ui.SourceComparisonPanel.message038', {
                            value0: String(source.versionNumber),
                          })
                        : ''}
                    </span>
                    {citation !== undefined ? (
                      <Button
                        variant="ghost"
                        size="compact"
                        href={citationPath(citation)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {uiText('ui.ClaimEvidencePanel.message011')}
                      </Button>
                    ) : null}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {analysis.command.criteria.map((criterion) => (
              <tr key={criterion}>
                <th scope="row">{criterion}</th>
                {analysis.sources.map((source) => {
                  const cell = analysis.answer.rows
                    .find((row) => row.sourceId === source.id)
                    ?.cells.find((item) => item.criterion === criterion);
                  return (
                    <td key={source.id}>
                      {cell?.status === 'REPORTED' && cell.text !== null ? (
                        <>
                          {cell.text}
                          <EvidenceLinks ids={cell.evidenceIds} analysis={analysis} />
                        </>
                      ) : (
                        <span className={styles.missing}>
                          {uiText('ui.SourceComparisonPanel.message039')}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <section
        className={styles.summary}
        aria-label={uiText('ui.SourceComparisonPanel.message040')}
      >
        <h4>
          <Icon name="sparkle" /> {uiText('ui.SourceComparisonPanel.message041')}
        </h4>
        {analysis.answer.summary.length === 0 ? (
          <p className={styles.missing}>
            {uiText('ui.SourceComparisonPanel.message042')}
          </p>
        ) : null}
        {analysis.answer.summary.map((statement, index) => (
          <p key={index}>
            {statement.text}
            <EvidenceLinks ids={statement.evidenceIds} analysis={analysis} />
          </p>
        ))}
      </section>
    </section>
  );
}
const categories = {
  get POTENTIAL_DISAGREEMENT() {
    return uiText('ui.SourceComparisonPanel.message053');
  },
  get DIFFERENT_REPORTED_RESULT() {
    return uiText('ui.SourceComparisonPanel.message054');
  },
  get DIFFERENT_EXPERIMENTAL_CONDITIONS() {
    return uiText('ui.SourceComparisonPanel.message055');
  },
};
export function DisagreementResult({
  analysis,
}: {
  readonly analysis: SourceAnalysis;
}): ReactElement {
  useUiLocale();
  return (
    <section
      aria-label={uiText('ui.SourceComparisonPanel.message043')}
      className={styles.findings}
    >
      <h3>{uiText('ui.SourceComparisonPanel.message044')}</h3>
      <Provenance analysis={analysis} />
      {analysis.answer.status === 'NO_POTENTIAL_DISAGREEMENT' ? (
        <p>{uiText('ui.SourceComparisonPanel.message045')}</p>
      ) : null}
      {analysis.answer.status === 'INSUFFICIENT_EVIDENCE' ? (
        <p>{uiText('ui.SourceComparisonPanel.message046')}</p>
      ) : null}
      {analysis.answer.findings.map((finding, index) => (
        <article
          key={index}
          id={`evidence-finding-${analysis.id}-${index}`}
          tabIndex={-1}
          className={styles.finding}
        >
          <CreateReviewTaskButton
            workspaceId={analysis.workspaceId}
            target={{
              targetType: 'EVIDENCE_FINDING',
              targetId: analysis.id,
              findingIndex: index,
            }}
          />
          <h4>{categories[finding.category]}</h4>
          <p>{finding.description}</p>
          {finding.sides.map((side) => (
            <p key={side.sourceId}>
              <strong>
                {analysis.sources.find((source) => source.id === side.sourceId)?.title ??
                  uiText('ui.AiDraftBlock.message007')}
                :{' '}
              </strong>
              {side.text}
              <EvidenceLinks ids={side.evidenceIds} analysis={analysis} />
            </p>
          ))}
          <p>
            <strong>{uiText('ui.SourceComparisonPanel.message047')} </strong>
            {finding.methodologicalContext.status === 'MISSING'
              ? uiText('ui.SourceComparisonPanel.message048')
              : finding.methodologicalContext.text}
            <EvidenceLinks
              ids={finding.methodologicalContext.evidenceIds}
              analysis={analysis}
            />
          </p>
        </article>
      ))}
    </section>
  );
}
