import { t as uiText, useLocale as useUiLocale } from '../../../shared/i18n';
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import type { SolutionBundle, SolutionStep } from '../api/solutionApi';
import { mathValue } from '../../documents/api/mathAst';
import { renderMath } from '../../documents/api/mathExtension';
import styles from './SolutionView.module.css';

function SavedStep({ step }: { readonly step: SolutionStep }): ReactElement {
  useUiLocale();
  return (
    <section
      className={styles.solution}
      id={`step-${step.id}`}
      aria-label={uiText('ui.SolutionView.message001', { value0: step.outputId })}
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
            {symbol} = {p.value} {p.unit} {uiText('ui.SolutionView.message002')}{' '}
            {p.siValue}
          </li>
        ))}
      </ul>
      <p>
        {uiText('ui.SolutionView.message003')} {step.values.join(', ')} {step.unit}
      </p>
      <p>
        {uiText('ui.SolutionView.message004')} {step.check}{' '}
        {uiText('ui.SolutionView.message005')} {step.id}
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
  useUiLocale();
  if (mode === 'STEP') {
    const step = bundle.steps.find((s) => s.id === stepId);
    return step ? (
      <SavedStep step={step} />
    ) : (
      <p role="alert">{uiText('ui.SolutionView.message006')}</p>
    );
  }
  if (mode === 'INPUTS')
    return (
      <section
        className={styles.solution}
        aria-label={uiText('ui.SolutionView.message007')}
      >
        <h3>{uiText('ui.SolutionView.message008')}</h3>
        <p>{bundle.statement}</p>
        <p>
          {uiText('ui.ProblemStudio.message007')} {bundle.domain}
        </p>
        <ul>
          {bundle.inputs.map((p) => (
            <li key={p.symbol}>
              {p.symbol} = {p.value} {p.unit}
            </li>
          ))}
          {bundle.unknowns.map((p) => (
            <li key={p.symbol}>
              {uiText('ui.SolutionView.message009')} {p.symbol} ({p.unit})
            </li>
          ))}
        </ul>
      </section>
    );
  if (mode === 'ASSUMPTIONS')
    return (
      <section
        className={styles.solution}
        aria-label={uiText('ui.SolutionView.message010')}
      >
        <h3>{uiText('ui.SolutionView.message011')}</h3>
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
    <section
      className={styles.solution}
      aria-label={uiText('ui.SolutionView.message012')}
    >
      <h3>{uiText('ui.SolutionView.message012')}</h3>
      <p>{uiText('ui.SolutionView.message013')}</p>
      {bundle.outputs.map((o) => (
        <p key={o.name}>
          {o.name}: {o.values.join(', ')} {o.unit}
        </p>
      ))}
      <p>
        {uiText('ui.SolutionView.message014')} {bundle.precision.absolute}
        {uiText('ui.SolutionView.message015')} {bundle.precision.relative}.
      </p>
      <details>
        <summary>{uiText('ui.SolutionView.message016')}</summary>
        {bundle.steps.map((step) => (
          <SavedStep key={step.id} step={step} />
        ))}
        <p>
          {uiText('ui.ProblemStudio.message012')} {bundle.inputHash}
        </p>
        <p>
          {uiText('ui.SolutionView.message017')} {bundle.planHash}
        </p>
        <p>
          {uiText('ui.SolutionView.message018')} {bundle.runtimeVersion}
        </p>
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
  useUiLocale();
  return (
    <Link
      to={`/app/workspaces/${workspaceId}/analyses/${bundle.analysisId}?execution=${encodeURIComponent(bundle.executionId)}${stepId ? `#step-${stepId}` : ''}`}
      target="_blank"
      rel="noreferrer"
    >
      {uiText('ui.SolutionView.message019')}
      {stepId ? ' ' + uiText('ui.SolutionView.message020') : ''}
    </Link>
  );
}
