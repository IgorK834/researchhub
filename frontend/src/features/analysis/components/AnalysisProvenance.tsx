import { t as uiText, useLocale as useUiLocale } from '../../../shared/i18n';
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import type { ExecutionRecord } from '../api/analysisApi';
import { AnalysisStatus } from './AnalysisStatus';
import styles from './Analysis.module.css';

export function AnalysisProvenance({
  record,
}: {
  readonly record: ExecutionRecord;
}): ReactElement {
  useUiLocale();
  const { execution: run, snapshot } = record;
  return (
    <div className={styles.provenance}>
      <h2>{uiText('ui.AnalysisProvenance.message001')}</h2>
      <p className={styles.meta}>{uiText('ui.AnalysisProvenance.message002')}</p>
      <ol className={styles.chain}>
        <li>
          <strong>{uiText('ui.AnalysisProvenance.message003')}</strong>
          {snapshot.lineage ? (
            <Link
              to={`/app/workspaces/${run.workspaceId}/analyses/${snapshot.lineage.originAnalysisId}?execution=${encodeURIComponent(snapshot.lineage.originExecutionId)}`}
            >
              {uiText('ui.AnalysisProvenance.message004')}{' '}
              {snapshot.lineage.originExecutionId}
            </Link>
          ) : (
            <p>{uiText('ui.AnalysisProvenance.message004')}</p>
          )}
        </li>
        <li>
          <strong>{uiText('ui.AnalysisProvenance.message005')}</strong>
          {snapshot.inputs.map((input) => (
            <div key={input.sourceVersionId}>
              <Link
                to={`/app/workspaces/${run.workspaceId}/sources/${input.sourceId}?version=${encodeURIComponent(input.sourceVersionId)}`}
              >
                {input.originalFilename} · v{input.versionNumber}
              </Link>
              <code className={styles.hash}>{input.sourceVersionId}</code>
              <span className={styles.meta}>
                {input.sizeBytes} {uiText('ui.AnalysisProvenance.message006')}
              </span>
              <code className={styles.hash}>{input.sha256}</code>
              {input.sheets.map((sheet) => (
                <p key={sheet.name}>
                  <strong>{sheet.name}</strong> ·{' '}
                  {sheet.columns
                    .map(
                      (c) =>
                        `${c.label ?? uiText('ui.AnalysisProvenance.message007')} [${c.index}]`,
                    )
                    .join(', ')}
                </p>
              ))}
            </div>
          ))}
        </li>
        <li>
          <strong>{uiText('ui.AnalysisProvenance.message008')}</strong>
          <p className={styles.preserve}>{snapshot.userPrompt}</p>
        </li>
        <li>
          <strong>{uiText('ui.AnalysisProvenance.message009')}</strong>
          <p>{snapshot.plan.summary}</p>
          <code className={styles.hash}>{run.provenance.planId}</code>
          {[...snapshot.plan.transformations, ...snapshot.plan.statisticalOperations].map(
            (step, i) => (
              <p key={i}>
                {step.name}: {step.description}
              </p>
            ),
          )}
          <span className={styles.meta}>
            {uiText('ui.AnalysisProvenance.message010')}
          </span>
          <code className={styles.hash}>{run.provenance.planSha256}</code>
        </li>
        <li>
          <strong>{uiText('ui.AnalysisProvenance.message011')}</strong>
          <span className={styles.meta}>
            {uiText('ui.AnalysisProvenance.message012')}
          </span>
          <code className={styles.hash}>{run.provenance.codeSha256}</code>
        </li>
        <li>
          <strong>
            {uiText('ui.AnalysisProvenance.message013')} {run.attempt}
          </strong>
          <AnalysisStatus status={run.status} />
          <dl className={styles.facts}>
            <div>
              <dt>{uiText('ui.AnalysisProvenance.message014')}</dt>
              <dd>{run.requestedBy}</dd>
            </div>
            <div>
              <dt>{uiText('ui.AnalysisProvenance.message015')}</dt>
              <dd>{run.startedAt ?? uiText('ui.AnalysisProvenance.message016')}</dd>
            </div>
            <div>
              <dt>{uiText('ui.AnalysisProvenance.message017')}</dt>
              <dd>{run.finishedAt ?? uiText('ui.AnalysisProvenance.message018')}</dd>
            </div>
            <div>
              <dt>{uiText('ui.AnalysisProvenance.message019')}</dt>
              <dd>
                {run.provenance.runtimeVersion ?? uiText('ui.AnalysisChart.message001')}
              </dd>
            </div>
            <div>
              <dt>{uiText('ui.AnalysisProvenance.message020')}</dt>
              <dd>
                {run.diagnostics?.configuredImage ??
                  uiText('ui.AnalysisChart.message001')}
              </dd>
            </div>
            <div>
              <dt>{uiText('ui.AnalysisProvenance.message021')}</dt>
              <dd>
                <code>
                  {run.provenance.imageId ?? uiText('ui.AnalysisChart.message001')}
                </code>
              </dd>
            </div>
            <div>
              <dt>{uiText('ui.AnalysisProvenance.message022')}</dt>
              <dd>
                {run.diagnostics?.exitCode ?? uiText('ui.AnalysisChart.message001')}
              </dd>
            </div>
            <div>
              <dt>{uiText('ui.AnalysisProvenance.message023')}</dt>
              <dd>
                {run.diagnostics
                  ? `${(run.diagnostics.durationMillis / 1000).toFixed(2)} s`
                  : uiText('ui.AnalysisChart.message001')}
              </dd>
            </div>
          </dl>
        </li>
        <li>
          <strong>{uiText('ui.AnalysisProvenance.message024')}</strong>
          {run.result ? (
            run.result.outputs.map((o) => (
              <p key={o.name}>
                {o.name} ·{' '}
                {o.kind === 'TABLE'
                  ? uiText('ui.AnalysisProvenance.message025', {
                      value0: o.rows.length,
                      value1: o.columns.length,
                    })
                  : o.kind}
              </p>
            ))
          ) : (
            <p>{uiText('ui.AnalysisProvenance.message026')}</p>
          )}
          {record.charts.map((chart) => (
            <p key={chart.image.id}>
              {chart.image.filename} · {chart.image.sizeBytes}{' '}
              {uiText('ui.AnalysisProvenance.message027')}
              <code className={styles.hash}>{chart.image.sha256}</code>
            </p>
          ))}
        </li>
      </ol>
      <details>
        <summary>{uiText('ui.AnalysisProvenance.message028')}</summary>
        {[...snapshot.plan.assumptions, ...snapshot.plan.warnings].map((note, i) => (
          <p key={i}>{note}</p>
        ))}
      </details>
      {run.diagnostics ? (
        <details>
          <summary>{uiText('ui.AnalysisProvenance.message029')}</summary>
          <p className={styles.meta}>{uiText('ui.AnalysisProvenance.message030')}</p>
          {run.status === 'FAILED' ? (
            <p>{uiText('ui.AnalysisProvenance.message031')}</p>
          ) : (
            <>
              <h3>
                {uiText('ui.AnalysisProvenance.message032')}
                {run.diagnostics.stdoutTruncated
                  ? ' ' + uiText('ui.AnalysisProvenance.message033')
                  : ''}
              </h3>
              <pre className={styles.logs}>
                {run.diagnostics.stdout || uiText('ui.AnalysisProvenance.message034')}
              </pre>
              <h3>
                {uiText('ui.AnalysisProvenance.message035')}
                {run.diagnostics.stderrTruncated
                  ? ' ' + uiText('ui.AnalysisProvenance.message033')
                  : ''}
              </h3>
              <pre className={styles.logs}>
                {run.diagnostics.stderr || uiText('ui.AnalysisProvenance.message034')}
              </pre>
            </>
          )}
        </details>
      ) : null}
    </div>
  );
}
