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
  const [error, setError] = useState('');
  const request = useRef(crypto.randomUUID());
  const save = useMutation({
    mutationFn: (problem: ProblemInput) =>
      createProblem(workspaceId, problem, parent, request.current),
    onSuccess: (a) => onCreated(a.id),
  });
  return (
    <form
      className={styles.form}
      aria-label="Scientific problem"
      onSubmit={(e) => {
        e.preventDefault();
        setError('');
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
          setError(err instanceof Error ? err.message : 'Invalid formula');
        }
      }}
    >
      <h2>
        {parent
          ? 'Complete or change the saved problem'
          : 'Scientific problem — no dataset required'}
      </h2>
      <label>
        Problem statement
        <textarea
          aria-label="Problem statement"
          maxLength={4000}
          value={statement}
          onChange={(e) => setStatement(e.target.value)}
          required
        />
      </label>
      <label>
        Calculation
        <select
          aria-label="Calculation"
          value={mode}
          onChange={(e) => setMode(e.target.value as 'EVALUATE' | 'SOLVE')}
        >
          <option value="EVALUATE">Evaluate formula</option>
          <option value="SOLVE">Solve polynomial equation (degree ≤ 4)</option>
        </select>
      </label>
      <label>
        Formula
        <input
          aria-label="Problem formula"
          value={formula}
          maxLength={1000}
          onChange={(e) => setFormula(e.target.value)}
          placeholder="distance / time"
        />
      </label>
      {mode === 'SOLVE' && (
        <label>
          Unknown
          <input
            aria-label="Unknown"
            value={unknown}
            maxLength={16}
            onChange={(e) => setUnknown(e.target.value)}
          />
        </label>
      )}
      <label>
        Result unit
        <input
          aria-label="Result unit"
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
          maxLength={16}
        />
      </label>
      <label>
        Parameters
        <textarea
          aria-label="Problem parameters"
          value={parameters}
          onChange={(e) => setParameters(e.target.value)}
          maxLength={3000}
          placeholder={'distance;100;m\ntime;20;s'}
        />
      </label>
      <p>
        One parameter per line: symbol;canonical decimal;unit. Use a decimal point.
        Supported units: 1, m, cm, km, s, ms, kg, g, m/s, m/s^2, N, J, Pa, rad, deg, A, mA, V, ohm, kohm, W, mW.
        Degrees are explicitly converted to radians.
      </p>
      <label>
        <input
          type="checkbox"
          checked={domain}
          onChange={(e) => setDomain(e.target.checked)}
        />
        Use the REAL domain
      </label>
      <label>
        Assumptions
        <textarea
          aria-label="Problem assumptions"
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
        Generate plot
      </label>
      {plot && (
        <label>
          Plot range
          <input
            aria-label="Plot range"
            value={range}
            onChange={(e) => setRange(e.target.value)}
          />
          <span>parameter;start;end;points (2–201)</span>
        </label>
      )}
      <p>
        {parent
          ? 'Changing inputs saves a new analysis linked to this immutable snapshot.'
          : 'Missing values, units or domain are saved as a request for clarification.'}
      </p>
      {(error || save.error) && <p role="alert">{error || describeError(save.error)}</p>}
      <Button type="submit" disabled={save.isPending}>
        Save problem
      </Button>
    </form>
  );
}
