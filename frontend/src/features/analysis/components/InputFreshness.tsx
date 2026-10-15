import type { ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { describeError } from '../../../shared/api';
import { t, useLocale } from '../../../shared/i18n';
import { fetchAnalysis, type AnalysisStaleness } from '../api/analysisApi';
export function InputFreshness({
  staleness,
}: {
  readonly staleness?: AnalysisStaleness;
}): ReactElement | null {
  useLocale();
  if (!staleness?.stale) return null;
  return (
    <div role="status">
      <h3>{t('stale.title')}</h3>
      <p>{t('stale.policy')}</p>
      <ul>
        {staleness.changedInputs.map((input, i) => (
          <li key={i}>
            {t('stale.original')}:{' '}
            {input.originalVersion?.number ?? t('stale.unavailable')} ·{' '}
            {t('stale.latest')}: {input.currentVersion?.number ?? t('stale.unavailable')}
            <p>{t(`stale.${input.reason}`)}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
export function EmbeddedInputFreshness({
  workspaceId,
  analysisId,
}: {
  readonly workspaceId: string;
  readonly analysisId: string;
}): ReactElement {
  const query = useQuery({
    queryKey: ['analysis-freshness', workspaceId, analysisId],
    queryFn: () => fetchAnalysis(workspaceId, analysisId),
    retry: false,
    refetchOnMount: 'always',
  });
  return (
    <>
      {query.error ? (
        <p role="status">
          {t('ui.DocumentAnalysisBlock.message012')} {describeError(query.error)}
        </p>
      ) : (
        <InputFreshness staleness={query.data?.staleness} />
      )}
    </>
  );
}
