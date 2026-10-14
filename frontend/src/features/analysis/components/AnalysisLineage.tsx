import { t as uiText, useLocale as useUiLocale } from '../../../shared/i18n';
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
  useUiLocale();
  const changed = lineage.versions.some(
    (v) => v.originalVersionId !== v.selectedVersionId,
  );
  return (
    <Banner
      tone={changed ? 'warning' : 'info'}
      lead={
        changed
          ? uiText('ui.AnalysisLineage.message001')
          : uiText('ui.AnalysisLineage.message002')
      }
    >
      <p>
        {lineage.inputMode === 'LATEST'
          ? uiText('ui.AnalysisLineage.message003')
          : uiText('ui.AnalysisLineage.message004')}
      </p>
      <ul>
        {lineage.versions.map((v) => (
          <li key={v.sourceId}>
            {uiText('ui.AiDraftBlock.message007')} {v.sourceId.slice(0, 8)}: v
            {v.originalVersionNumber} → v{v.selectedVersionNumber}
            {v.originalVersionId === v.selectedVersionId
              ? ' ' + uiText('ui.AnalysisLineage.message005')
              : ' ' + uiText('ui.AnalysisLineage.message006')}
          </li>
        ))}
      </ul>
      <Link
        to={`/app/workspaces/${workspaceId}/analyses/${lineage.originAnalysisId}?execution=${encodeURIComponent(lineage.originExecutionId)}`}
      >
        {uiText('ui.AnalysisLineage.message007')}
      </Link>
    </Banner>
  );
}
