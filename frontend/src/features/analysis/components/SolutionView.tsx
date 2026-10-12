import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import type { SolutionBundle, SolutionStep } from '../api/solutionApi';
import { mathValue } from '../../documents/api/mathAst';
import { renderMath } from '../../documents/api/mathExtension';
import styles from './SolutionView.module.css';

function SavedStep({ step }: { readonly step: SolutionStep }): ReactElement {
  return (
    <section
      className={styles.solution}
      id={`step-${step.id}`}
      aria-label={`Saved calculation step ${step.outputId}`}
    >
      <h4>
        {step.outputId} · {step.operation}
      </h4>
      <div
        ref={(el) => {
          if (el) {
            try {
              renderMath(el, mathValue(step.expression), true);
            } catch {
              el.textContent = 'Formula unavailable';
            }
          }
        }}
      />
      <ul>
        {Object.entries(step.substitution).map(([symbol, p]) => (
          <li key={symbol}>
            {symbol} = {p.value} {p.unit} · SI: {p.siValue}
          </li>
        ))}
      </ul>
      <p>
        Step result: {step.values.join(', ')} {step.unit}
      </p>
      <p>
        Arithmetic: {step.check} · Step {step.id}
      </p>
    </section>
  );
}
export function SolutionView({
  bundle,
  mode = 'SOLUTION',
  stepId = null,
}: {
  readonly bundle: SolutionBundle;
  readonly mode?: 'SOLUTION' | 'STEP' | 'INPUTS' | 'ASSUMPTIONS';
  readonly stepId?: string | null;
}): ReactElement {
  if (mode === 'STEP') {
    const step = bundle.steps.find((s) => s.id === stepId);
    return step ? (
      <SavedStep step={step} />
    ) : (
      <p role="alert">The saved step is unavailable.</p>
    );
  }
  if (mode === 'INPUTS')
    return (
      <section className={styles.solution} aria-label="Saved problem input">
        <h3>Frozen problem input</h3>
        <p>{bundle.statement}</p>
        <p>Domain: {bundle.domain}</p>
        <ul>
          {bundle.inputs.map((p) => (
            <li key={p.symbol}>
              {p.symbol} = {p.value} {p.unit}
            </li>
          ))}
          {bundle.unknowns.map((p) => (
            <li key={p.symbol}>
              Unknown: {p.symbol} ({p.unit})
            </li>
          ))}
        </ul>
      </section>
    );
  if (mode === 'ASSUMPTIONS')
    return (
      <section className={styles.solution} aria-label="Unchecked interpretation">
        <h3>Interpretation: NOT_CHECKED</h3>
        <p>{bundle.interpretation.summary}</p>
        <ul>
          {bundle.interpretation.assumptions.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
        {bundle.interpretation.warnings.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </section>
    );
  return (
    <section className={styles.solution} aria-label="Saved solution">
      <h3>Saved solution</h3>
      <p>
        Arithmetic checked in a fresh sandbox. Interpretation and physical assumptions are
        not checked.
      </p>
      {bundle.outputs.map((o) => (
        <p key={o.name}>
          {o.name}: {o.values.join(', ')} {o.unit}
        </p>
      ))}
      <p>
        Absolute tolerance {bundle.precision.absolute}; relative tolerance{' '}
        {bundle.precision.relative}.
      </p>
      <details>
        <summary>Saved steps and verification</summary>
        {bundle.steps.map((step) => (
          <SavedStep key={step.id} step={step} />
        ))}
        <p>Input hash: {bundle.inputHash}</p>
        <p>Plan hash: {bundle.planHash}</p>
        <p>Runtime: {bundle.runtimeVersion}</p>
        <pre>{JSON.stringify(bundle.codeHashes, null, 2)}</pre>
        <pre>{JSON.stringify(bundle.receipt, null, 2)}</pre>
      </details>
    </section>
  );
}
export function StepDetailsLink({
  workspaceId,
  bundle,
  stepId,
}: {
  readonly workspaceId: string;
  readonly bundle: SolutionBundle;
  readonly stepId?: string | null;
}): ReactElement {
  return (
    <Link
      to={`/app/workspaces/${workspaceId}/analyses/${bundle.analysisId}?execution=${encodeURIComponent(bundle.executionId)}${stepId ? `#step-${stepId}` : ''}`}
      target="_blank"
      rel="noreferrer"
    >
      Open exact execution{stepId ? ' and step' : ''}
    </Link>
  );
}
