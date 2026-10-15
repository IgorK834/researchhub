import styles from './ParameterRunForm.module.css';
import type { ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { fetchProblemExecutions, type ProblemExecution } from '../api/problemApi';
import { t, useLocale } from '../../../shared/i18n';
import { describeError } from '../../../shared/api';
export function ParameterComparison({
  workspaceId,
  parentAnalysisId,
  current,
}: {
  readonly workspaceId: string;
  readonly parentAnalysisId: string;
  readonly current: ProblemExecution;
}): ReactElement {
  useLocale();
  const parent = useQuery({
    queryKey: ['parameter-comparison', workspaceId, parentAnalysisId],
    queryFn: () => fetchProblemExecutions(workspaceId, parentAnalysisId),
    retry: false,
  });
  const original = parent.error
    ? undefined
    : parent.data?.find((e) => e.status === 'SUCCEEDED');
  return (
    <section className={styles.panel}>
      <h3>{t('parameters.compare')}</h3>
      <Link to={`/app/workspaces/${workspaceId}/analyses/${parentAnalysisId}`}>
        {t('parameters.original')}
      </Link>
      {parent.isPending ? <p role="status">{t('collab.loading')}</p> : null}
      {parent.error ? <p role="alert">{describeError(parent.error)}</p> : null}
      {original?.result ? (
        <table className={styles.comparison}>
          <thead>
            <tr>
              <th>{t('parameters.output')}</th>
              <th>{t('parameters.original')}</th>
              <th>{t('parameters.new')}</th>
            </tr>
          </thead>
          <tbody>
            {current.result?.outputs.map((o) => (
              <tr key={o.name}>
                <td>
                  {o.name} ({o.unit})
                </td>
                <td>
                  {original
                    .result!.outputs.find((p) => p.name === o.name)
                    ?.values.join(', ') ?? '—'}
                </td>
                <td>{o.values.join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p>{t('parameters.noComparison')}</p>
      )}
    </section>
  );
}
