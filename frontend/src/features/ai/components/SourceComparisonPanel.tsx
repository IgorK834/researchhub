import { useState, type ReactElement } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { describeError } from '../../../shared/api';
import { useSourcesQuery } from '../../sources/api/useSources';
import { citationPath } from '../api/generationApi';
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
  const sources = useSourcesQuery(workspaceId);
  const [selected, setSelected] = useState<readonly string[]>([]);
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
    <section aria-labelledby="source-comparison-heading">
      <h2 id="source-comparison-heading">Compare sources</h2>
      <p>
        AI-assisted interpretation of selected source excerpts. Review the cited passages;
        missing information remains missing.
      </p>
      {sources.isPending ? <p role="status">Loading comparison sources…</p> : null}
      {sources.error !== null ? (
        <p role="alert">
          Could not load comparison sources: {describeError(sources.error)}
        </p>
      ) : null}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const fields = criteria
            .split('\n')
            .map((field) => field.trim())
            .filter(Boolean);
          if (
            selected.length < 2 ||
            selected.length > 5 ||
            selected.some((id) => !sources.data?.some((s) => s.id === id))
          ) {
            setValidation('Select 2–5 sources from this workspace.');
            return;
          }
          if (
            fields.length < 1 ||
            fields.length > 5 ||
            fields.some((field) => field.length > 64) ||
            new Set(fields.map((field) => field.toLowerCase())).size !== fields.length
          ) {
            setValidation(
              'Enter 1–5 distinct criteria, one per line (up to 64 characters each).',
            );
            return;
          }
          setValidation(null);
          differences.reset();
          setVersionSelection('ORIGINAL');
          compare.mutate({
            selectedSourceIds: selected,
            criteria: fields,
            instruction: instruction.trim() || null,
          });
        }}
      >
        <fieldset disabled={busy || sources.isPending || sources.error !== null}>
          <legend>Select 2–5 sources to compare</legend>
          {(sources.data ?? []).map((source) => (
            <label key={source.id}>
              <input
                type="checkbox"
                checked={selected.includes(source.id)}
                onChange={(event) =>
                  setSelected(
                    event.target.checked
                      ? [...selected, source.id]
                      : selected.filter((id) => id !== source.id),
                  )
                }
              />
              {source.displayName}
            </label>
          ))}
          {sources.data?.length === 0 ? (
            <p>No sources available for comparison.</p>
          ) : null}
          <label>
            Comparison criteria (one per line)
            <textarea
              maxLength={324}
              value={criteria}
              onChange={(event) => setCriteria(event.target.value)}
            />
          </label>
          <label>
            Comparison instruction (optional)
            <textarea
              maxLength={1000}
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
            />
          </label>
          <button type="submit">
            {compare.isPending ? 'Comparing…' : 'Compare selected sources'}
          </button>
        </fieldset>
      </form>
      {validation === null ? null : <p role="alert">{validation}</p>}
      {compare.error === null ? null : (
        <p role="alert">Comparison failed: {describeError(compare.error)}</p>
      )}
      {compare.data !== undefined && !compare.isPending ? (
        <>
          <ComparisonResult analysis={compare.data} />
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (compare.data !== undefined)
                differences.mutate({
                  id: compare.data.id,
                  instruction: focus.trim() || null,
                  versions: versionSelection,
                });
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
              Disagreement analysis focus (optional)
              <textarea
                disabled={busy}
                maxLength={1000}
                value={focus}
                onChange={(event) => setFocus(event.target.value)}
              />
            </label>
            <button type="submit" disabled={busy}>
              {differences.isPending
                ? 'Checking potential disagreements…'
                : 'Find potential disagreements'}
            </button>
          </form>
        </>
      ) : null}
      {differences.error === null ? null : (
        <p role="alert">
          Disagreement analysis failed: {describeError(differences.error)}
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
  const newer = analysis.sources.filter((source) => {
    const current = currentVersionIds.get(source.id);
    return (
      source.sourceVersionId !== null &&
      current !== undefined &&
      current !== source.sourceVersionId
    );
  });
  return (
    <fieldset disabled={disabled}>
      <legend>Source versions for this analysis</legend>
      {newer.length === 0 ? null : (
        <p role="status">
          A newer version was uploaded after this comparison:{' '}
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
        Use the original versions from the comparison
      </label>
      <label>
        <input
          type="radio"
          name="source-version-selection"
          value="LATEST"
          checked={value === 'LATEST'}
          onChange={() => onChange('LATEST')}
        />
        Use the latest versions (re-reads the sources)
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
  return (
    <span>
      {ids.map((id) => {
        const citation = analysis.evidence.find((item) => item.chunkId === id);
        if (citation === undefined) return <span key={id}> [Unavailable reference]</span>;
        return (
          <Link key={id} to={citationPath(citation)}>
            {' '}
            [{citation.title ?? 'Source'}
            {citation.pageStart === null
              ? citation.sectionTitle === null
                ? ''
                : `, ${citation.sectionTitle}`
              : `, p. ${citation.pageStart}`}
            ]
          </Link>
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
        <p>
          Model: {analysis.generation.model.name} · Template:{' '}
          {analysis.generation.templateId} · Analysis: {analysis.id}
        </p>
      )}
    </>
  );
}
export function ComparisonResult({
  analysis,
}: {
  readonly analysis: SourceAnalysis;
}): ReactElement {
  return (
    <section aria-label="Source comparison result">
      <h3>AI-assisted comparison</h3>
      <Provenance analysis={analysis} />
      {analysis.answer.status === 'INSUFFICIENT_EVIDENCE' ? (
        <p>Insufficient evidence in retrieved excerpts.</p>
      ) : null}
      <div className="source-comparison-table" style={{ overflowX: 'auto' }}>
        <table>
          <caption>Research criteria in selected source excerpts</caption>
          <thead>
            <tr>
              <th scope="col">Criterion</th>
              {analysis.sources.map((source) => (
                <th scope="col" key={source.id}>
                  {source.title}
                  {source.versionNumber > 0
                    ? ` (version ${String(source.versionNumber)})`
                    : ''}
                </th>
              ))}
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
                      {cell?.status === 'REPORTED' ? (
                        <>
                          {cell.text}
                          <EvidenceLinks ids={cell.evidenceIds} analysis={analysis} />
                        </>
                      ) : (
                        'Missing in retrieved excerpts'
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h4>Narrative summary</h4>
      {analysis.answer.summary.map((statement, index) => (
        <p key={index}>
          {statement.text}
          <EvidenceLinks ids={statement.evidenceIds} analysis={analysis} />
        </p>
      ))}
    </section>
  );
}
const categories = {
  POTENTIAL_DISAGREEMENT: 'Potential disagreement',
  DIFFERENT_REPORTED_RESULT: 'Different reported result',
  DIFFERENT_EXPERIMENTAL_CONDITIONS: 'Different experimental conditions',
};
export function DisagreementResult({
  analysis,
}: {
  readonly analysis: SourceAnalysis;
}): ReactElement {
  return (
    <section aria-label="Potential disagreement result">
      <h3>AI-assisted interpretation: potential disagreements</h3>
      <Provenance analysis={analysis} />
      {analysis.answer.status === 'NO_POTENTIAL_DISAGREEMENT' ? (
        <p>
          No potential disagreement identified in these excerpts. This does not establish
          agreement between the full sources.
        </p>
      ) : null}
      {analysis.answer.status === 'INSUFFICIENT_EVIDENCE' ? (
        <p>Insufficient evidence from at least two sources.</p>
      ) : null}
      {analysis.answer.findings.map((finding, index) => (
        <article key={index}>
          <h4>{categories[finding.category]}</h4>
          <p>{finding.description}</p>
          {finding.sides.map((side) => (
            <p key={side.sourceId}>
              <strong>
                {analysis.sources.find((source) => source.id === side.sourceId)?.title ??
                  'Source'}
                :{' '}
              </strong>
              {side.text}
              <EvidenceLinks ids={side.evidenceIds} analysis={analysis} />
            </p>
          ))}
          <p>
            <strong>Methodological/context differences: </strong>
            {finding.methodologicalContext.status === 'MISSING'
              ? 'Unavailable in retrieved excerpts; assess comparability in the original sources.'
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
