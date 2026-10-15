import styles from './ParameterRunForm.module.css';
import { useState, type ReactElement } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../../shared/components/Button';
import { describeError } from '../../../shared/api';
import { t, useLocale } from '../../../shared/i18n';
import { parameterRunApi, type ParameterRun } from '../api/parameterRunApi';
import type { ProblemAnalysis } from '../api/problemApi';
export function ParameterRunForm({
  analysis,
}: {
  readonly analysis: ProblemAnalysis;
}): ReactElement {
  useLocale();
  const navigate = useNavigate();
  const definitions = useQuery({
    queryKey: ['parameters', analysis.workspaceId, analysis.id],
    queryFn: () => parameterRunApi.definitions(analysis.workspaceId, analysis.id),
    retry: false,
  });
  const [values, setValues] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<'ORIGINAL' | 'LATEST'>('ORIGINAL');
  const [plot, setPlot] = useState(analysis.snapshot.problem.plot);
  const [identity, setIdentity] = useState(() => crypto.randomUUID());
  const run = useMutation({
    mutationFn: () => {
      const parameters: ParameterRun['parameters'] = {};
      for (const d of definitions.data!)
        parameters[d.name] = {
          type: 'DECIMAL',
          value: values[d.name] ?? d.defaultValue,
          unit: d.unit,
        };
      return parameterRunApi.run(analysis.workspaceId, analysis.id, {
        idempotencyKey: identity,
        parameters,
        inputMode: mode,
        plot,
      });
    },
    onSuccess: (r) =>
      navigate(
        `/app/workspaces/${analysis.workspaceId}/analyses/${r.analysisId}?execution=${encodeURIComponent(r.executionId)}`,
      ),
  });
  function changed(): void {
    setIdentity(crypto.randomUUID());
    run.reset();
  }
  return (
    <section className={styles.panel}>
      <h2>{t('parameters.title')}</h2>
      <p>{t('parameters.cost')}</p>
      {definitions.isPending ? <p role="status">{t('collab.loading')}</p> : null}
      {definitions.error || run.error ? (
        <p role="alert">{describeError(definitions.error ?? run.error)}</p>
      ) : null}
      {definitions.data && !definitions.error ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run.mutate();
          }}
        >
          <fieldset className={styles.fields} disabled={run.isPending}>
            {definitions.data.map((d) => (
              <label key={d.name}>
                {d.name} ({d.unit})
                <input
                  required
                  value={values[d.name] ?? d.defaultValue}
                  onChange={(e) => {
                    setValues({ ...values, [d.name]: e.target.value });
                    changed();
                  }}
                />
                <small>
                  {d.bounds.minimum} … {d.bounds.maximum} · {t('parameters.original')}:{' '}
                  {d.defaultValue} {d.unit}
                </small>
              </label>
            ))}
            <label>
              {t('parameters.inputs')}
              <select
                value={mode}
                onChange={(e) => {
                  setMode(e.target.value as typeof mode);
                  changed();
                }}
              >
                <option value="ORIGINAL">{t('stale.original')}</option>
                <option value="LATEST">{t('stale.latest')}</option>
              </select>
            </label>
            <p>{t('parameters.inputPolicy')}</p>
            {plot ? (
              <>
                <label>
                  {t('parameters.start')}
                  <input
                    required
                    value={plot.start}
                    onChange={(e) => {
                      setPlot({ ...plot, start: e.target.value });
                      changed();
                    }}
                  />
                </label>
                <label>
                  {t('parameters.end')}
                  <input
                    required
                    value={plot.end}
                    onChange={(e) => {
                      setPlot({ ...plot, end: e.target.value });
                      changed();
                    }}
                  />
                </label>
                <label>
                  {t('parameters.points')}
                  <input
                    type="number"
                    min={2}
                    max={201}
                    value={plot.points}
                    onChange={(e) => {
                      setPlot({ ...plot, points: Number(e.target.value) });
                      changed();
                    }}
                  />
                </label>
              </>
            ) : null}
            <h3>{t('parameters.preview')}</h3>
            <ul>
              {definitions.data.map((d) => (
                <li key={d.name}>
                  {d.name}: {d.defaultValue} → {values[d.name] ?? d.defaultValue} {d.unit}
                </li>
              ))}
            </ul>
            <Button type="submit" busy={run.isPending}>
              {t('parameters.run')}
            </Button>
          </fieldset>
        </form>
      ) : null}
    </section>
  );
}
