import { getIntlLocale } from '../../../shared/i18n';
import { t as uiText, useLocale as useUiLocale } from '../../../shared/i18n';
import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient, describeError } from '../../../shared/api';
import { SlideOver } from '../../../shared/components/overlays';
import type { PreviewCitation } from '../../ai/components/Citations';
import { citationPath } from '../../ai/api/generationApi';
import { fetchSourceVersions } from '../../sources/api/sourceApi';
import {
  fetchExecutionRecord,
  type ExecutionRecord,
} from '../../analysis/api/analysisApi';
import { fetchSolution, type SolutionBundle } from '../../analysis/api/solutionApi';
import { AnalysisProvenance } from '../../analysis/components/AnalysisProvenance';
import type { AnalysisReference } from '../api/analysisReference';
import type { OriginOperation } from './DocumentProvenance';
import styles from './DocumentProvenance.module.css';

export type ProvenanceTarget = { readonly trigger?: HTMLElement } & (
  | { kind: 'citation'; citation: PreviewCitation }
  | { kind: 'analysis'; workspaceId: string; reference: AnalysisReference }
  | { kind: 'block'; workspaceId: string; documentId: string; blockId: string | null }
);
const OpenProvenance = createContext<((target: ProvenanceTarget) => void) | null>(null);
export const useOpenProvenance = () => useContext(OpenProvenance);

export function ProvenanceProvider({
  children,
}: {
  readonly children: ReactNode;
}): ReactElement {
  const [target, setTarget] = useState<ProvenanceTarget | null>(null);
  return (
    <OpenProvenance.Provider value={setTarget}>
      {children}
      <ProvenancePanel target={target} onClose={() => setTarget(null)} />
    </OpenProvenance.Provider>
  );
}
export function ProvenancePanel({
  target,
  onClose,
}: {
  readonly target: ProvenanceTarget | null;
  readonly onClose: () => void;
}): ReactElement {
  useUiLocale();
  const returnFocusRef = useMemo(
    () => ({ current: target?.trigger ?? null }),
    [target?.trigger],
  );
  return (
    <SlideOver
      open={target !== null}
      title={uiText('ui.DocumentProvenance.message002')}
      onClose={onClose}
      returnFocusRef={returnFocusRef}
    >
      <div className={styles.inspector}>
        {target?.kind === 'citation' ? (
          <CitationProvenance citation={target.citation} />
        ) : null}
        {target?.kind === 'analysis' ? (
          <AnalysisDetails
            workspaceId={target.workspaceId}
            reference={target.reference}
          />
        ) : null}
        {target?.kind === 'block' ? <BlockDetails {...target} /> : null}
      </div>
    </SlideOver>
  );
}
function CitationProvenance({
  citation,
}: {
  readonly citation: PreviewCitation;
}): ReactElement {
  useUiLocale();
  const versions = useQuery({
    queryKey: ['citation-provenance', citation.workspaceId, citation.sourceId],
    queryFn: ({ signal }) =>
      fetchSourceVersions(citation.workspaceId, citation.sourceId, signal),
    enabled: citation.sourceVersionId !== null,
    retry: false,
  });
  const version = versions.data?.find((v) => v.id === citation.sourceVersionId);
  return (
    <>
      <h3>{uiText('ui.ProvenancePanel.message001')}</h3>
      {citation.sourceVersionId !== null && versions.isPending ? (
        <p role="status">{uiText('ui.ProvenancePanel.message002')}</p>
      ) : null}
      {versions.error ? (
        <p role="alert">
          {uiText('ui.ProvenancePanel.message003')} {describeError(versions.error)}
        </p>
      ) : null}
      {versions.data && !version ? (
        <p role="status">{uiText('ui.ProvenancePanel.message004')}</p>
      ) : null}
      <dl>
        <dt>{uiText('ui.ProvenancePanel.message005')}</dt>
        <dd>
          {version?.originalFilename ??
            citation.title ??
            uiText('ui.AnalysisChart.message001')}
        </dd>
        <dt>{uiText('ui.ProvenancePanel.message006')}</dt>
        <dd>
          {citation.sourceVersionId ?? uiText('ui.ProvenancePanel.message007')}
          {version ? ` · v${version.versionNumber}` : ''}
        </dd>
        <dt>{uiText('ui.ProvenancePanel.message008')}</dt>
        <dd>
          {citation.pageStart !== null
            ? uiText('ui.ProvenancePanel.message009', {
                value0: citation.pageStart,
                value1:
                  citation.pageEnd !== null && citation.pageEnd !== citation.pageStart
                    ? `–${citation.pageEnd}`
                    : '',
              })
            : (citation.sectionTitle ??
              (citation.spans.map((s) => s.unitId).join(', ') ||
                uiText('ui.AnalysisChart.message001')))}
        </dd>
        <dt>{uiText('ui.ProvenancePanel.message010')}</dt>
        <dd>
          <code>{citation.contentHash}</code>
        </dd>
        <dt>{uiText('ui.ProvenancePanel.message011')}</dt>
        <dd>
          <code>{version?.contentSha256 ?? uiText('ui.AnalysisChart.message001')}</code>
        </dd>
        <dt>{uiText('ui.ProvenancePanel.message012')}</dt>
        <dd>{citation.processingVersion}</dd>
      </dl>
      <a href={citationPath({ ...citation, chunkId: citation.chunkId ?? '' })}>
        {uiText('ui.ProvenancePanel.message013')}
      </a>
    </>
  );
}
function AnalysisDetails({
  workspaceId,
  reference,
}: {
  readonly workspaceId: string;
  readonly reference: AnalysisReference;
}): ReactElement {
  useUiLocale();
  const saved = useQuery<ExecutionRecord | SolutionBundle>({
    queryKey: [
      'panel-analysis-provenance',
      workspaceId,
      reference.analysisId,
      reference.executionId,
      reference.workload,
    ],
    queryFn: ({ signal }) =>
      reference.workload === 'PROBLEM'
        ? fetchSolution(workspaceId, reference.analysisId, reference.executionId, signal)
        : fetchExecutionRecord(
            workspaceId,
            reference.analysisId,
            reference.executionId,
            signal,
          ),
    retry: false,
  });
  if (saved.isPending)
    return <p role="status">{uiText('ui.ProvenancePanel.message014')}</p>;
  if (saved.error)
    return (
      <p role="alert">
        {uiText('ui.ProvenancePanel.message015')} {describeError(saved.error)}
      </p>
    );
  if ('execution' in saved.data) return <AnalysisProvenance record={saved.data} />;
  const solution = saved.data;
  return (
    <>
      <h3>{uiText('ui.ProvenancePanel.message016')}</h3>
      <dl>
        <dt>{uiText('ui.ProvenancePanel.message017')}</dt>
        <dd>
          <code>{solution.inputHash}</code>
        </dd>
        <dt>{uiText('ui.ProvenancePanel.message018')}</dt>
        <dd>
          <code>{solution.planHash}</code>
        </dd>
        <dt>{uiText('ui.AnalysisProvenance.message019')}</dt>
        <dd>{solution.runtimeVersion}</dd>
        <dt>{uiText('ui.ProvenancePanel.message019')}</dt>
        <dd>{solution.imageId}</dd>
        <dt>{uiText('ui.ProvenancePanel.message020')}</dt>
        <dd>
          {Object.entries(solution.codeHashes).map(([name, hash]) => (
            <p key={name}>
              {name}: <code>{hash}</code>
            </p>
          ))}
        </dd>
        <dt>{uiText('ui.ProvenancePanel.message021')}</dt>
        <dd>
          {solution.outputs.map((o) => o.name).join(', ') ||
            uiText('ui.ProvenancePanel.message022')}
        </dd>
        <dt>{uiText('ui.AnalysisProvenance.message023')}</dt>
        <dd>{uiText('ui.ProvenancePanel.message023')}</dd>
        <dt>{uiText('ui.AnalysisProvenance.message003')}</dt>
        <dd>
          <pre>
            {solution.origin
              ? JSON.stringify(solution.origin, null, 2)
              : uiText('ui.AnalysisProvenance.message004')}
          </pre>
        </dd>
      </dl>
    </>
  );
}
function BlockDetails({
  workspaceId,
  documentId,
  blockId,
}: {
  readonly workspaceId: string;
  readonly documentId: string;
  readonly blockId: string | null;
}): ReactElement {
  useUiLocale();
  const history = useQuery({
    queryKey: ['document-provenance', workspaceId, documentId, blockId],
    queryFn: ({ signal }) =>
      apiClient.get<OriginOperation[]>(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/documents/${encodeURIComponent(documentId)}/blocks/${encodeURIComponent(blockId!)}/provenance`,
        { signal },
      ),
    enabled: blockId !== null,
    retry: false,
  });
  if (blockId === null) return <p>{uiText('ui.ProvenancePanel.message024')}</p>;
  if (history.isPending)
    return <p role="status">{uiText('ui.ProvenancePanel.message025')}</p>;
  if (history.error)
    return (
      <p role="alert">
        {uiText('ui.ProvenancePanel.message026')} {describeError(history.error)}
      </p>
    );
  if (history.data.length === 0) return <p>{uiText('ui.ProvenancePanel.message027')}</p>;
  return (
    <>
      <h3>{uiText('ui.DocumentProvenance.message011')}</h3>
      <p>{uiText('ui.ProvenancePanel.message028')}</p>
      <ol>
        {history.data.map((op) => (
          <li key={op.id}>
            <strong>
              {op.operationType === 'TEMPLATE_APPLIED'
                ? uiText('templates.origin')
                : op.category}
            </strong>
            <dl>
              {op.metadata.documentTemplate ? (
                <>
                  <dt>{uiText('templates.select')}</dt>
                  <dd>
                    {op.metadata.documentTemplate.templateId} ·{' '}
                    {uiText('templates.version', {
                      version: op.metadata.documentTemplate.version,
                    })}{' '}
                    · {op.metadata.documentTemplate.locale.toUpperCase()}
                  </dd>
                  <dt>SHA-256</dt>
                  <dd>
                    <code>{op.metadata.documentTemplate.templateSha256}</code>
                  </dd>
                </>
              ) : null}
              {op.category.startsWith('AI_') ? (
                <>
                  <dt>{uiText('ui.ProvenancePanel.message029')}</dt>
                  <dd>
                    {op.metadata.model?.name ?? uiText('ui.AnalysisChart.message001')}
                  </dd>
                  <dt>{uiText('ui.ProvenancePanel.message030')}</dt>
                  <dd>
                    {op.metadata.model?.version ?? uiText('ui.AnalysisChart.message001')}
                  </dd>
                  <dt>{uiText('ui.ProvenancePanel.message031')}</dt>
                  <dd>
                    {op.metadata.templateId ?? uiText('ui.AnalysisChart.message001')}
                    {op.metadata.templateHash ? (
                      <code>{op.metadata.templateHash}</code>
                    ) : null}
                  </dd>
                </>
              ) : null}
              <dt>
                {op.operationType === 'AI_ACCEPTED'
                  ? uiText('ui.ProvenancePanel.message032')
                  : uiText('ui.ProvenancePanel.message033')}
              </dt>
              <dd>
                {op.actorName} ·{' '}
                {op.actorUserId ?? uiText('ui.DocumentHistory.message017')}
              </dd>
              <dt>
                {op.operationType === 'AI_ACCEPTED'
                  ? uiText('ui.ProvenancePanel.message034')
                  : uiText('ui.ProvenancePanel.message035')}
              </dt>
              <dd>
                <time dateTime={op.createdAt}>
                  {new Date(op.createdAt).toLocaleString(getIntlLocale())}
                </time>
              </dd>
              <dt>{uiText('ui.ProvenancePanel.message036')}</dt>
              <dd>{op.documentRevision}</dd>
            </dl>
          </li>
        ))}
      </ol>
    </>
  );
}
