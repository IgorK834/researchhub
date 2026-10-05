import { useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../../shared/components/Button';
import { Card, IconTile } from '../../../shared/components/content';
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
  const [offset, setOffset] = useState(0);
  const analyses = useAnalysesQuery(workspaceId, true, offset);
  return (
    <section className={styles.page} aria-labelledby="workspace-analyses-heading">
      <div className={styles.heading}>
        <div>
          <h1 id="workspace-analyses-heading">Analyses</h1>
          <p>Data, code, execution and results — kept together for every attempt.</p>
        </div>
        {canEdit ? (
          <Link
            className={styles.primaryLink}
            to={`/app/workspaces/${workspaceId}/analyses/new`}
          >
            New analysis
          </Link>
        ) : null}
      </div>
      {analyses.isPending ? <p role="status">Loading analyses…</p> : null}
      {analyses.error ? (
        <Banner tone="error" lead="Could not load analyses">
          {describeError(analyses.error)}
          <Button
            variant="ghost"
            onClick={() => {
              void analyses.refetch();
            }}
          >
            Try again
          </Button>
        </Banner>
      ) : null}
      {analyses.data?.length === 0 ? (
        <Card>
          <h2>No analyses on this page</h2>
          <p>
            Computed results and their provenance appear here after an analysis is
            created.
          </p>
        </Card>
      ) : null}
      <ul className={styles.list}>
        {analyses.data?.map((analysis) => (
          <li key={analysis.id}>
            <Card className={styles.analysisCard}>
              <IconTile icon="lineChart" tone="mint" size="large" />
              <div>
                <AnalysisStatus status={analysis.status} />
                <h2>
                  <Link to={`/app/workspaces/${workspaceId}/analyses/${analysis.id}`}>
                    {analysis.plan?.summary ?? analysis.userPrompt}
                  </Link>
                </h2>
                <p className={styles.meta}>
                  {analysis.inputs.length} immutable input{' '}
                  {analysis.inputs.length === 1 ? 'version' : 'versions'} ·{' '}
                  {new Date(analysis.createdAt).toLocaleString()}
                </p>
              </div>
              <Link
                className={styles.secondaryLink}
                to={`/app/workspaces/${workspaceId}/analyses/${analysis.id}`}
              >
                Open analysis
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
          Newer analyses
        </Button>
        <Button
          variant="ghost"
          disabled={!analyses.data || analyses.data.length < 50}
          onClick={() => setOffset(offset + 50)}
        >
          Older analyses
        </Button>
      </div>
    </section>
  );
}
