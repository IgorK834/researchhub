import { getIntlLocale } from '../../../shared/i18n';
import { t as uiText, useLocale as useUiLocale } from '../../../shared/i18n';
import { useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../../shared/components/Button';
import { Card, EmptyState, IconTile } from '../../../shared/components/content';
import { Illustration } from '../../../shared/components/Illustration';
import { Banner } from '../../../shared/components/feedback';
import { describeError } from '../../../shared/api';
import { useAnalysesQuery } from '../api/useAnalyses';
import { AnalysisStatus } from './AnalysisStatus';
import styles from './Analysis.module.css';

export function AnalysisList({
  workspaceId,
  canEdit,
}: {
  readonly workspaceId: string;
  readonly canEdit: boolean;
}): ReactElement {
  useUiLocale();
  const [offset, setOffset] = useState(0);
  const analyses = useAnalysesQuery(workspaceId, true, offset);
  return (
    <section className={styles.page} aria-labelledby="workspace-analyses-heading">
      <div className={styles.heading}>
        <div>
          <h1 id="workspace-analyses-heading">{uiText('ui.AnalysisList.message001')}</h1>
          <p>{uiText('ui.AnalysisList.message002')}</p>
        </div>
        {canEdit ? (
          <Link
            className={styles.primaryLink}
            to={`/app/workspaces/${workspaceId}/analyses/new`}
          >
            {uiText('ui.AnalysisList.message003')}
          </Link>
        ) : null}
      </div>
      {analyses.isPending ? (
        <p role="status">{uiText('ui.AnalysisList.message004')}</p>
      ) : null}
      {analyses.error ? (
        <Banner tone="error" lead={uiText('ui.AnalysisList.message016')}>
          {describeError(analyses.error)}
          <Button
            variant="ghost"
            onClick={() => {
              void analyses.refetch();
            }}
          >
            {uiText('ui.AnalysisChart.message004')}
          </Button>
        </Banner>
      ) : null}
      {analyses.error === null && !analyses.isPending && analyses.data?.length === 0 ? (
        <EmptyState
          context={uiText('ui.AnalysisList.message005')}
          title={
            offset === 0
              ? uiText('ui.AnalysisList.message006')
              : uiText('ui.AnalysisList.message007')
          }
          description={uiText('ui.AnalysisList.message008')}
          art={<Illustration scene={offset === 0 ? 'analyses' : 'search'} />}
          tone={offset === 0 ? 'yellow' : 'blue'}
          actions={
            offset === 0 && canEdit
              ? [
                  <Button
                    key="create"
                    href={`/app/workspaces/${workspaceId}/analyses/new`}
                    icon="lineChart"
                  >
                    {uiText('ui.AnalysisList.message009')}
                  </Button>,
                ]
              : undefined
          }
        />
      ) : null}
      <ul className={styles.list}>
        {analyses.data?.map((analysis) => (
          <li key={analysis.id}>
            <Card className={styles.analysisCard}>
              <IconTile icon="lineChart" tone="mint" size="large" />
              <div>
                <AnalysisStatus status={analysis.status} />
                {analysis.staleness?.stale ? <p>{uiText('stale.title')}</p> : null}
                <h2>
                  <Link to={`/app/workspaces/${workspaceId}/analyses/${analysis.id}`}>
                    {analysis.plan?.summary ?? analysis.userPrompt}
                  </Link>
                </h2>
                <p className={styles.meta}>
                  {analysis.inputs.length} {uiText('ui.AnalysisList.message010')}{' '}
                  {analysis.inputs.length === 1
                    ? uiText('ui.AnalysisList.message011')
                    : uiText('ui.AnalysisList.message012')}{' '}
                  · {new Date(analysis.createdAt).toLocaleString(getIntlLocale())}
                </p>
              </div>
              <Link
                className={styles.secondaryLink}
                to={`/app/workspaces/${workspaceId}/analyses/${analysis.id}`}
              >
                {uiText('ui.AnalysisList.message013')}
              </Link>
            </Card>
          </li>
        ))}
      </ul>
      <div className={styles.actions}>
        <Button
          variant="ghost"
          disabled={offset === 0}
          onClick={() => setOffset(Math.max(0, offset - 50))}
        >
          {uiText('ui.AnalysisList.message014')}
        </Button>
        <Button
          variant="ghost"
          disabled={!analyses.data || analyses.data.length < 50}
          onClick={() => setOffset(offset + 50)}
        >
          {uiText('ui.AnalysisList.message015')}
        </Button>
      </div>
    </section>
  );
}
