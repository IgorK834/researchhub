import { EmbeddedInputFreshness } from '../../analysis/components/InputFreshness';
import { t as uiText, useLocale as useUiLocale } from '../../../shared/i18n';
import { useState, type ReactElement } from 'react';
import { NodeViewWrapper, useEditorState, type NodeViewProps } from '@tiptap/react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { fetchExecutionRecord } from '../../analysis/api/analysisApi';
import { AnalysisChart } from '../../analysis/components/AnalysisChart';
import { ResultTable } from '../../analysis/components/AnalysisResult';
import { AnalysisOutputPicker } from '../../analysis/components/AnalysisOutputPicker';
import { describeError, queryKeys } from '../../../shared/api';
import { Button } from '../../../shared/components/Button';
import { isAnalysisBlockAttrs, type AnalysisReference } from '../api/analysisReference';
import styles from './DocumentAnalysisBlock.module.css';
import { ProblemReferencedOutput } from './ProblemReferencedOutput';
import { ProvenancePanel, useOpenProvenance } from '../provenance/ProvenancePanel';

export function DocumentAnalysisBlock({
  node,
  editor,
  updateAttributes,
  extension,
}: NodeViewProps): ReactElement {
  useUiLocale();
  const workspaceId = extension.options.workspaceId as string | undefined;
  const attrs = isAnalysisBlockAttrs(node.attrs) ? node.attrs : null;
  const [updating, setUpdating] = useState(false);
  const canEdit = useEditorState({
    editor,
    selector: ({ editor: current }) => current.isEditable,
  });
  return (
    <NodeViewWrapper
      id={attrs ? `analysis-${attrs.blockId}` : undefined}
      className={styles.block}
      contentEditable={false}
      data-analysis-block={attrs?.blockId}
    >
      {!workspaceId || !attrs ? (
        <p role="alert">{uiText('ui.DocumentAnalysisBlock.message001')}</p>
      ) : attrs.reference.workload === 'PROBLEM' ? (
        <ProblemReferencedOutput
          workspaceId={workspaceId}
          reference={attrs.reference}
          caption={attrs.caption}
          canEdit={canEdit}
          onUpdate={() => setUpdating(!updating)}
        />
      ) : (
        <ReferencedOutput
          workspaceId={workspaceId}
          reference={attrs.reference}
          caption={attrs.caption}
          canEdit={canEdit}
          onUpdate={() => setUpdating(!updating)}
        />
      )}
      {updating && workspaceId && attrs && canEdit ? (
        <div className={styles.update}>
          <h3>{uiText('ui.DocumentAnalysisBlock.message002')}</h3>
          <p>{uiText('ui.DocumentAnalysisBlock.message003')}</p>
          <AnalysisOutputPicker
            workspaceId={workspaceId}
            initial={attrs.reference}
            onChoose={(reference) => {
              if (editor.isEditable) updateAttributes({ reference });
              setUpdating(false);
            }}
          />
          <Button variant="ghost" onClick={() => setUpdating(false)}>
            {uiText('ui.DocumentAnalysisBlock.message004')}
          </Button>
        </div>
      ) : null}
    </NodeViewWrapper>
  );
}
export function ReferencedOutput({
  workspaceId,
  reference,
  caption,
  canEdit,
  onUpdate,
}: {
  readonly workspaceId: string;
  readonly reference: AnalysisReference;
  readonly caption: string;
  readonly canEdit: boolean;
  readonly onUpdate: () => void;
}): ReactElement {
  useUiLocale();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const openProvenance = useOpenProvenance();
  const showProvenance = (): void => {
    if (openProvenance) openProvenance({ kind: 'analysis', workspaceId, reference });
    else setDetailsOpen(true);
  };
  const record = useQuery({
    queryKey: queryKeys.executionRecord(
      workspaceId,
      reference.analysisId,
      reference.executionId,
    ),
    queryFn: ({ signal }) =>
      fetchExecutionRecord(
        workspaceId,
        reference.analysisId,
        reference.executionId,
        signal,
      ),
  });
  const saved = record.error ? undefined : record.data;
  const output =
    saved?.execution.status === 'SUCCEEDED'
      ? saved.execution.result?.outputs.find(
          (output) =>
            output.name === reference.outputId &&
            (output.kind === 'TEXT' ? 'SUMMARY' : output.kind) === reference.renderMode,
        )
      : undefined;
  const chart = saved?.charts.find((chart) => chart.name === reference.outputId);
  const index = saved?.execution.result?.outputs.findIndex(
    (output) => output.name === reference.outputId,
  );
  const details = `/app/workspaces/${workspaceId}/analyses/${reference.analysisId}?execution=${encodeURIComponent(reference.executionId)}#output-${index ?? 0}`;
  return (
    <>
      {record.isPending ? (
        <p role="status">{uiText('ui.DocumentAnalysisBlock.message005')}</p>
      ) : null}
      {record.error ? (
        <p role="alert">
          {uiText('ui.DocumentAnalysisBlock.message006')} {describeError(record.error)}
        </p>
      ) : null}
      {saved && !output ? (
        <p role="alert">{uiText('ui.DocumentAnalysisBlock.message007')}</p>
      ) : null}
      {output?.kind === 'CHART' && chart && reference.renderMode === 'CHART' ? (
        <AnalysisChart
          workspaceId={workspaceId}
          chart={chart}
          onDetails={showProvenance}
        />
      ) : null}
      {output?.kind === 'TABLE' && reference.renderMode === 'TABLE' ? (
        <ResultTable output={output} />
      ) : null}
      {output?.kind === 'TEXT' && reference.renderMode === 'SUMMARY' ? (
        <p className={styles.summary}>{output.text}</p>
      ) : null}
      {caption ? (
        <p className={styles.caption}>
          {reference.schemaVersion === '2.0' ? (
            <>
              {uiText('ui.DocumentAnalysisBlock.message008')} {caption}
            </>
          ) : (
            caption
          )}
        </p>
      ) : null}
      <div className={styles.footer}>
        <Button variant="secondary" onClick={showProvenance}>
          {uiText('ui.Citations.message006')}
        </Button>
        <span>
          {uiText('ui.AnalysisOutputPicker.message003')}{' '}
          {reference.analysisId.slice(0, 8)}{' '}
          {uiText('ui.DocumentAnalysisBlock.message009')}{' '}
          {reference.executionId.slice(0, 8)}
        </span>
        <Link to={details} target="_blank" rel="noreferrer">
          {uiText('ui.GroundedAnswer.message021')}
        </Link>
        {canEdit ? (
          <Button variant="ghost" onClick={onUpdate}>
            {uiText('ui.AnalysisWidgets.message017')}
          </Button>
        ) : null}
      </div>
      {saved ? (
        <p className={styles.sources}>
          {uiText('ui.DocumentAnalysisBlock.message010')}{' '}
          {saved.snapshot.inputs
            .map(
              (input) =>
                `${input.originalFilename} · v${input.versionNumber} · ${input.sheets.map((sheet) => sheet.name).join(', ')}`,
            )
            .join('; ')}
        </p>
      ) : null}
      <EmbeddedInputFreshness
        workspaceId={workspaceId}
        analysisId={reference.analysisId}
      />
      <ProvenancePanel
        target={detailsOpen ? { kind: 'analysis', workspaceId, reference } : null}
        onClose={() => setDetailsOpen(false)}
      />
    </>
  );
}
