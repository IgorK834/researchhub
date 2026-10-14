import { t as uiText, useLocale as useUiLocale } from '../../../shared/i18n';
import styles from './Problem.module.css';
import { useRef, useState, type ReactElement } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button } from '../../../shared/components/Button';
import { mathPlain, parseMath } from '../../documents/api/mathAst';
import {
  createProblem,
  type ProblemAnalysis,
  type ProblemInput,
} from '../api/problemApi';
import { describeError } from '../../../shared/api';
export function ProblemForm({
  workspaceId,
  parent = null,
  onCreated,
}: {
  readonly workspaceId: string;
  readonly parent?: ProblemAnalysis | null;
  readonly onCreated: (id: string) => void;
}): ReactElement {
  const locale = useUiLocale();
  const original = parent?.snapshot.problem;
  const [statement, setStatement] = useState(original?.statement ?? '');
  const [formula, setFormula] = useState(
    original?.expectedOutputs[0]?.expression
      ? mathPlain(original.expectedOutputs[0].expression)
      : '',
  );
  const [unit, setUnit] = useState(original?.expectedOutputs[0]?.unit ?? '1');
  const [mode, setMode] = useState<'EVALUATE' | 'SOLVE'>(
    original?.expectedOutputs[0]?.kind ?? 'EVALUATE',
  );
  const [unknown, setUnknown] = useState(original?.unknowns[0]?.symbol ?? 'x');
  const [domain, setDomain] = useState(original?.domain === 'REAL');
  const [parameters, setParameters] = useState(
    original?.parameters
      .map((p) => `${p.symbol};${p.value ?? ''};${p.unit ?? ''}`)
      .join('\n') ?? '',
  );
  const [assumptions, setAssumptions] = useState(original?.assumptions.join('\n') ?? '');
  const [plot, setPlot] = useState(!!original?.plot);
  const [range, setRange] = useState(
    original?.plot
      ? `${original.plot.parameter};${original.plot.start};${original.plot.end};${original.plot.points}`
      : 'x;0;10;51',
  );
  const [error, setError] = useState<Error | null>(null);
  const request = useRef(crypto.randomUUID());
  const save = useMutation({
    mutationFn: (problem: ProblemInput) =>
      createProblem(workspaceId, problem, parent, request.current),
    onSuccess: (a) => onCreated(a.id),
  });
  return (
    <form
      className={styles.form}
      aria-label={uiText('ui.ProblemForm.message001')}
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        try {
          const rows = parameters.trim()
            ? parameters
                .split('\n')
                .filter((s) => s.trim())
                .map((row) => {
                  const parts = row.split(';').map((s) => s.trim());
                  if (parts.length !== 3)
                    throw new Error('Each parameter needs symbol;value;unit');
                  return {
                    symbol: parts[0]!,
                    value: parts[1] || null,
                    unit: parts[2] || null,
                  };
                })
            : [];
          const plotValues = range.split(';').map((s) => s.trim());
          save.mutate({
            statement,
            parameters: rows,
            unknowns: mode === 'SOLVE' ? [{ symbol: unknown, unit }] : [],
            domain: domain ? 'REAL' : null,
            expectedOutputs: formula
              ? [
                  {
                    name: 'result',
                    kind: mode,
                    expression: parseMath(formula),
                    unit: unit || null,
                  },
                ]
              : [],
            assumptions: assumptions.split('\n').filter((s) => s.trim()),
            plot: plot
              ? {
                  parameter: plotValues[0] ?? '',
                  start: plotValues[1] ?? '',
                  end: plotValues[2] ?? '',
                  points: Number(plotValues[3]),
                  output: 'result',
                }
              : null,
          });
        } catch (err) {
          setError(
            err instanceof Error ? err : new Error(uiText('ui.ProblemForm.message002')),
          );
        }
      }}
    >
      <h2>
        {parent
          ? uiText('ui.ProblemForm.message003')
          : uiText('ui.ProblemForm.message004')}
      </h2>
      <label>
        {uiText('ui.ProblemForm.message005')}
        <textarea
          aria-label={uiText('ui.ProblemForm.message005')}
          maxLength={4000}
          value={statement}
          onChange={(e) => setStatement(e.target.value)}
          required
        />
      </label>
      <label>
        {uiText('ui.ProblemForm.message006')}
        <select
          aria-label={uiText('ui.ProblemForm.message006')}
          value={mode}
          onChange={(e) => setMode(e.target.value as 'EVALUATE' | 'SOLVE')}
        >
          <option value="EVALUATE">{uiText('ui.ProblemForm.message007')}</option>
          <option value="SOLVE">{uiText('ui.ProblemForm.message008')}</option>
        </select>
      </label>
      <label>
        {uiText('ui.ProblemForm.message009')}
        <input
          aria-label={uiText('ui.ProblemForm.message010')}
          value={formula}
          maxLength={1000}
          onChange={(e) => setFormula(e.target.value)}
          placeholder={uiText('ui.ProblemForm.message011')}
        />
      </label>
      {mode === 'SOLVE' && (
        <label>
          {uiText('ui.ProblemForm.message012')}
          <input
            aria-label={uiText('ui.ProblemForm.message012')}
            value={unknown}
            maxLength={16}
            onChange={(e) => setUnknown(e.target.value)}
          />
        </label>
      )}
      <label>
        {uiText('ui.ProblemForm.message013')}
        <input
          aria-label={uiText('ui.ProblemForm.message013')}
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
          maxLength={16}
        />
      </label>
      <label>
        {uiText('ui.ProblemForm.message014')}
        <textarea
          aria-label={uiText('ui.ProblemForm.message015')}
          value={parameters}
          onChange={(e) => setParameters(e.target.value)}
          maxLength={3000}
          placeholder={uiText('ui.ProblemForm.message016')}
        />
      </label>
      <p>{uiText('ui.ProblemForm.message017')}</p>
      <label>
        <input
          type="checkbox"
          checked={domain}
          onChange={(e) => setDomain(e.target.checked)}
        />
        {uiText('ui.ProblemForm.message018')}
      </label>
      <label>
        {uiText('ui.AnalysisStudio.message031')}
        <textarea
          aria-label={uiText('ui.ProblemForm.message019')}
          value={assumptions}
          onChange={(e) => setAssumptions(e.target.value)}
          maxLength={6000}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={plot}
          onChange={(e) => setPlot(e.target.checked)}
        />
        {uiText('ui.ProblemForm.message020')}
      </label>
      {plot && (
        <label>
          {uiText('ui.ProblemForm.message021')}
          <input
            aria-label={uiText('ui.ProblemForm.message021')}
            value={range}
            onChange={(e) => setRange(e.target.value)}
          />
          <span>{uiText('ui.ProblemForm.message022')}</span>
        </label>
      )}
      <p>
        {parent
          ? uiText('ui.ProblemForm.message023')
          : uiText('ui.ProblemForm.message024')}
      </p>
      {(error || save.error) && (
        <p role="alert">
          {error
            ? locale === 'pl'
              ? uiText('problem.validation')
              : error.message
            : describeError(save.error)}
        </p>
      )}
      <Button type="submit" disabled={save.isPending}>
        {uiText('ui.ProblemForm.message025')}
      </Button>
    </form>
  );
}
