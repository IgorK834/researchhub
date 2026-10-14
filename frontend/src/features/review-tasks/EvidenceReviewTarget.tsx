import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import type { ReactElement } from 'react';
import { describeError } from '../../shared/api';
import { t, useLocale } from '../../shared/i18n';
import { fetchSourceAnalysis } from '../ai/api/sourceAnalysisApi';
import { DisagreementResult } from '../ai/components/SourceComparisonPanel';
export function EvidenceReviewTarget({
  workspaceId,
}: {
  readonly workspaceId: string;
}): ReactElement | null {
  useLocale();
  const [params] = useSearchParams(),
    id = params.get('evidenceAnalysis');
  const query = useQuery({
    queryKey: ['evidence-review-target', workspaceId, id],
    queryFn: () => fetchSourceAnalysis(workspaceId, id!),
    enabled: id !== null,
    retry: false,
  });
  if (id === null) return null;
  if (query.isPending) return <p role="status">{t('collab.loading')}</p>;
  if (query.error) return <p role="alert">{describeError(query.error)}</p>;
  return (
    <section>
      <DisagreementResult analysis={query.data} />
    </section>
  );
}
