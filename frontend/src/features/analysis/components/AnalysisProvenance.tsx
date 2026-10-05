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
  const { execution: run, snapshot } = record;
  return (
    <div className={styles.provenance}>
      <h2>Where this result came from</h2>
      <p className={styles.meta}>
        The exact data, request, code and execution are kept together for this attempt.
      </p>
      <ol className={styles.chain}>
        <li>
          <strong>Source versions</strong>
          {snapshot.inputs.map((input) => (
            <div key={input.sourceVersionId}>
              <Link
                to={`/app/workspaces/${run.workspaceId}/sources/${input.sourceId}?version=${encodeURIComponent(input.sourceVersionId)}`}
              >
                {input.originalFilename} · v{input.versionNumber}
              </Link>
              <code className={styles.hash}>{input.sourceVersionId}</code>
              <span className={styles.meta}>{input.sizeBytes} bytes · SHA-256</span>
              <code className={styles.hash}>{input.sha256}</code>
              {input.sheets.map((sheet) => (
                <p key={sheet.name}>
                  <strong>{sheet.name}</strong> ·{' '}
                  {sheet.columns
                    .map((c) => `${c.label ?? 'Column'} [${c.index}]`)
                    .join(', ')}
                </p>
              ))}
            </div>
          ))}
        </li>
        <li>
          <strong>Analysis request</strong>
          <p className={styles.preserve}>{snapshot.userPrompt}</p>
        </li>
        <li>
          <strong>Accepted plan</strong>
          <p>{snapshot.plan.summary}</p>
          <code className={styles.hash}>{run.provenance.planId}</code>
          {[...snapshot.plan.transformations, ...snapshot.plan.statisticalOperations].map(
            (step, i) => (
              <p key={i}>
                {step.name}: {step.description}
              </p>
            ),
          )}
          <span className={styles.meta}>Plan SHA-256</span>
          <code className={styles.hash}>{run.provenance.planSha256}</code>
        </li>
        <li>
          <strong>Generated Python</strong>
          <span className={styles.meta}>Code SHA-256</span>
          <code className={styles.hash}>{run.provenance.codeSha256}</code>
        </li>
        <li>
          <strong>Execution · attempt {run.attempt}</strong>
          <AnalysisStatus status={run.status} />
          <dl className={styles.facts}>
            <div>
              <dt>Requested by</dt>
              <dd>{run.requestedBy}</dd>
            </div>
            <div>
              <dt>Started</dt>
              <dd>{run.startedAt ?? 'Not started'}</dd>
            </div>
            <div>
              <dt>Finished</dt>
              <dd>{run.finishedAt ?? 'Not finished'}</dd>
            </div>
            <div>
              <dt>Runtime version</dt>
              <dd>{run.provenance.runtimeVersion ?? 'Not recorded'}</dd>
            </div>
            <div>
              <dt>Image</dt>
              <dd>{run.diagnostics?.configuredImage ?? 'Not recorded'}</dd>
            </div>
            <div>
              <dt>Image ID</dt>
              <dd>
                <code>{run.provenance.imageId ?? 'Not recorded'}</code>
              </dd>
            </div>
            <div>
              <dt>Exit status</dt>
              <dd>{run.diagnostics?.exitCode ?? 'Not recorded'}</dd>
            </div>
            <div>
              <dt>Duration</dt>
              <dd>
                {run.diagnostics
                  ? `${(run.diagnostics.durationMillis / 1000).toFixed(2)} s`
                  : 'Not recorded'}
              </dd>
            </div>
          </dl>
        </li>
        <li>
          <strong>Saved outputs</strong>
          {run.result ? (
            run.result.outputs.map((o) => (
              <p key={o.name}>
                {o.name} ·{' '}
                {o.kind === 'TABLE'
                  ? `${o.rows.length} rows, ${o.columns.length} columns`
                  : o.kind}
              </p>
            ))
          ) : (
            <p>No computed result was published.</p>
          )}
          {record.charts.map((chart) => (
            <p key={chart.image.id}>
              {chart.image.filename} · {chart.image.sizeBytes} bytes
              <code className={styles.hash}>{chart.image.sha256}</code>
            </p>
          ))}
        </li>
      </ol>
      <details>
        <summary>Assumptions and warnings</summary>
        {[...snapshot.plan.assumptions, ...snapshot.plan.warnings].map((note, i) => (
          <p key={i}>{note}</p>
        ))}
      </details>
      {run.diagnostics ? (
        <details>
          <summary>Execution diagnostics</summary>
          <p className={styles.meta}>Sanitized, bounded summaries from this attempt.</p>
          {run.status === 'FAILED' ? (
            <p>
              Failure diagnostics are represented by the safe guidance in the result view.
              Raw runtime traces are not displayed.
            </p>
          ) : (
            <>
              <h3>
                Standard output{run.diagnostics.stdoutTruncated ? ' (truncated)' : ''}
              </h3>
              <pre className={styles.logs}>{run.diagnostics.stdout || 'No output.'}</pre>
              <h3>
                Standard error{run.diagnostics.stderrTruncated ? ' (truncated)' : ''}
              </h3>
              <pre className={styles.logs}>{run.diagnostics.stderr || 'No output.'}</pre>
            </>
          )}
        </details>
      ) : null}
    </div>
  );
}
