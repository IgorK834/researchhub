import type { ReactElement } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AnalysisStudio } from '../features/analysis/components/AnalysisStudio';
import { NewAnalysis } from '../features/analysis/components/NewAnalysis';
import { useSourcesQuery } from '../features/sources/api/useSources';
import { useWorkspaceQuery } from '../features/workspaces/api/useWorkspaces';
import { workspaceCapabilities } from '../shared/utils/workspaceCapabilities';
import { describeError } from '../shared/api';

export function AnalysisPage(): ReactElement {
  const { workspaceId, analysisId } = useParams();
  if (!workspaceId || !analysisId) return <p>Analysis unavailable.</p>;
  return (
    <AuthorizedAnalysis
      key={`${workspaceId}/${analysisId}`}
      workspaceId={workspaceId}
      analysisId={analysisId}
    />
  );
}
function AuthorizedAnalysis({
  workspaceId,
  analysisId,
}: {
  readonly workspaceId: string;
  readonly analysisId: string;
}): ReactElement {
  const workspace = useWorkspaceQuery(workspaceId);
  const sources = useSourcesQuery(
    workspaceId,
    analysisId === 'new' && !!workspace.data && !workspace.error,
  );
  const navigate = useNavigate();
  const [search] = useSearchParams();
  if (workspace.isPending) return <p role="status">Loading workspace…</p>;
  if (workspace.error)
    return <p role="alert">Analysis unavailable: {describeError(workspace.error)}</p>;
  const { canEditContent } = workspaceCapabilities(
    workspace.data.role,
    workspace.data.archivedAt !== null,
  );
  if (analysisId !== 'new')
    return (
      <AnalysisStudio
        workspaceId={workspaceId}
        analysisId={analysisId}
        canEdit={canEditContent}
      />
    );
  if (!canEditContent)
    return (
      <section>
        <h1>Analyses</h1>
        <p>This workspace is read-only for you.</p>
        <Link to={`/app/workspaces/${workspaceId}/analyses`}>View saved analyses</Link>
      </section>
    );
  if (sources.isPending) return <p role="status">Loading datasets…</p>;
  if (sources.error)
    return <p role="alert">Could not load datasets: {describeError(sources.error)}</p>;
  return (
    <NewAnalysis
      workspaceId={workspaceId}
      datasets={sources.data
        .filter((s) => s.status === 'READY' && ['CSV', 'XLSX'].includes(s.sourceType))
        .map((s) => ({
          sourceId: s.id,
          sourceVersionId: s.activeVersionId,
          label: `${s.displayName} · v${s.activeVersionNumber}`,
        }))}
      initialVersionId={search.get('version') ?? undefined}
      onCreated={(id) => {
        void navigate(`/app/workspaces/${workspaceId}/analyses/${id}`);
      }}
    />
  );
}
