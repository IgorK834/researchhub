import { Link } from 'react-router-dom';
import type { ReactElement } from 'react';
import { Banner } from '../../../shared/components/feedback';
import type { AnalysisLineage as Lineage } from '../api/analysisApi';

export function AnalysisLineage({
  workspaceId,
  lineage,
}: {
  readonly workspaceId: string;
  readonly lineage: Lineage;
}): ReactElement {
  const changed = lineage.versions.some(
    (v) => v.originalVersionId !== v.selectedVersionId,
  );
  return (
    <Banner
      tone={changed ? 'warning' : 'info'}
      lead={changed ? 'Inputs changed for this run' : 'Original input versions retained'}
    >
      <p>
        {lineage.inputMode === 'LATEST'
          ? 'This derived analysis replanned the same request using the latest versions selected when it was created.'
          : 'This attempt uses the original source versions and accepted code.'}
      </p>
      <ul>
        {lineage.versions.map((v) => (
          <li key={v.sourceId}>
            Source {v.sourceId.slice(0, 8)}: v{v.originalVersionNumber} → v
            {v.selectedVersionNumber}
            {v.originalVersionId === v.selectedVersionId ? ' (unchanged)' : ' (changed)'}
          </li>
        ))}
      </ul>
      <Link
        to={`/app/workspaces/${workspaceId}/analyses/${lineage.originAnalysisId}?execution=${encodeURIComponent(lineage.originExecutionId)}`}
      >
        View original execution
      </Link>
    </Banner>
  );
}
