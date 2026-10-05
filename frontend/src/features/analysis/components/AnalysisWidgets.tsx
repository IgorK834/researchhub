import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Button } from '../../../shared/components/Button';
import { Icon, type IconName } from '../../../shared/components/icons';
import { Banner } from '../../../shared/components/feedback';
import { Panel } from '../../../shared/components/content';
import styles from './AnalysisWidgets.module.css';

/** Presentation values, independent of any planning, execution or transport contract. */
export type ComputationState = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED';
const states: Record<ComputationState, { label: string; icon: IconName; tone: string }> =
  {
    QUEUED: { label: 'Queued', icon: 'clock', tone: 'neutral' },
    RUNNING: { label: 'Running', icon: 'refresh', tone: 'active' },
    COMPLETED: { label: 'Completed', icon: 'check', tone: 'success' },
    FAILED: { label: 'Failed', icon: 'alert', tone: 'failed' },
  };
export function AnalysisStatusChip({
  state,
}: {
  readonly state: ComputationState;
}): ReactElement {
  const value = states[state];
  return (
    <span className={styles.status} data-tone={value.tone}>
      <Icon name={value.icon} size={14} />
      {value.label}
    </span>
  );
}
export interface PipelineStep {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly state: 'DONE' | 'IN_PROGRESS' | 'NEXT';
}
export function AnalysisPipeline({
  steps,
}: {
  readonly steps: readonly PipelineStep[];
}): ReactElement {
  return (
    <ol className={styles.pipeline} aria-label="Analysis progress">
      {steps.map((step) => (
        <li key={step.id} data-state={step.state}>
          <Icon
            name={
              step.state === 'DONE'
                ? 'check'
                : step.state === 'IN_PROGRESS'
                  ? 'refresh'
                  : 'clock'
            }
          />
          <div>
            <small>
              {step.state === 'DONE'
                ? 'Done'
                : step.state === 'IN_PROGRESS'
                  ? 'In progress'
                  : 'Next'}
            </small>
            <h3>{step.title}</h3>
            <p>{step.description}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
export function AnalysisCodePanel({
  id,
  code,
  language = 'Python',
  hash,
  open: controlled,
  onOpenChange,
  toggleVisible = true,
  footer,
}: {
  readonly id?: string;
  readonly code: string;
  readonly language?: string;
  readonly hash?: string;
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  readonly toggleVisible?: boolean;
  readonly footer?: ReactNode;
}): ReactElement {
  const [local, setLocal] = useState(false);
  const generatedId = useId();
  const panelId = id ?? generatedId;
  const open = controlled ?? local;
  const section = useRef<HTMLElement>(null);
  useEffect(() => {
    if (open && section.current) {
      section.current.focus({ preventScroll: true });
      section.current.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    }
  }, [open]);
  return (
    <div>
      {toggleVisible ? (
        <Button
          variant="secondary"
          icon="code"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => {
            setLocal(!open);
            onOpenChange?.(!open);
          }}
        >
          {open ? 'Hide code' : 'Show code'}
        </Button>
      ) : null}
      {open ? (
        <section
          id={panelId}
          aria-label="Generated code, read-only"
          ref={section}
          tabIndex={-1}
        >
          <Panel title={`The code that produced this · ${language}, read-only`}>
            <p>
              Code is read-only. Running it requires a separate, explicit analysis
              execution.
            </p>
            {hash ? (
              <p className={styles.hash}>
                SHA-256 <code>{hash}</code>
              </p>
            ) : null}
            {footer}
            <ol className={styles.code} aria-label="Code with line numbers">
              {code.split('\n').map((line, index) => (
                <li key={index}>
                  <code>{line || ' '}</code>
                </li>
              ))}
            </ol>
          </Panel>
        </section>
      ) : null}
    </div>
  );
}
export type ResultCell = string | number | boolean | null;
export interface ResultTableProps {
  readonly name: string;
  readonly columns: readonly string[];
  readonly rows: readonly (readonly ResultCell[])[];
  /** The caller identifies the calculated column; the component never guesses one. */
  readonly calculatedColumn?: number;
}
export function AnalysisResultTable({
  name,
  columns,
  rows,
  calculatedColumn,
}: ResultTableProps): ReactElement {
  const [page, setPage] = useState(0);
  const visiblePage = Math.min(page, Math.max(0, Math.ceil(rows.length / 25) - 1));
  const start = visiblePage * 25;
  return (
    <Panel title={name}>
      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <caption>{rows.length} saved rows</caption>
          <thead>
            <tr>
              {columns.map((column, index) => (
                <th key={index} scope="col" data-calculated={index === calculatedColumn}>
                  {column}
                  {index === calculatedColumn ? (
                    <span className="visually-hidden"> (calculated)</span>
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(start, start + 25).map((row, index) => (
              <tr key={start + index}>
                {columns.map((_, column) => (
                  <td key={column} data-calculated={column === calculatedColumn}>
                    {row[column] === null || row[column] === undefined
                      ? '—'
                      : String(row[column])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={styles.actions}>
        <span>
          {rows.length ? `${start + 1}–${Math.min(start + 25, rows.length)}` : '0'} of{' '}
          {rows.length} rows
        </span>
        <Button
          variant="ghost"
          disabled={visiblePage === 0}
          onClick={() => setPage(visiblePage - 1)}
        >
          Previous rows
        </Button>
        <Button
          variant="ghost"
          disabled={start + 25 >= rows.length}
          onClick={() => setPage(visiblePage + 1)}
        >
          Next rows
        </Button>
      </div>
    </Panel>
  );
}
export function AnalysisChartFrame({
  title,
  legend = [],
  caption,
  sourceFooter,
  children,
  onDetails,
}: {
  readonly title: string;
  readonly legend?: readonly string[];
  readonly caption?: string;
  readonly sourceFooter: string;
  readonly children: ReactNode;
  readonly onDetails?: () => void;
}): ReactElement {
  return (
    <Panel
      className={styles.chartFrame}
      title={title}
      header={
        onDetails ? (
          <Button variant="secondary" icon="layers" onClick={onDetails}>
            View provenance
          </Button>
        ) : undefined
      }
      footer={sourceFooter}
    >
      <figure className={styles.figure}>
        {children}
        {legend.length ? (
          <ul aria-label="Chart legend">
            {legend.map((text, index) => (
              <li key={index}>{text}</li>
            ))}
          </ul>
        ) : null}
        {caption ? <figcaption>{caption}</figcaption> : null}
      </figure>
    </Panel>
  );
}
export function AnalysisFreshnessBanner({
  outOfDate,
  message,
  onUpdate,
}: {
  readonly outOfDate: boolean;
  readonly message: string;
  readonly onUpdate?: () => void;
}): ReactElement | null {
  if (!outOfDate) return null;
  return (
    <Banner tone="warning" lead="Out of date">
      <p>{message}</p>
      {onUpdate ? (
        <Button variant="secondary" onClick={onUpdate}>
          Update reference
        </Button>
      ) : null}
    </Banner>
  );
}
export function AnalysisListItem({
  title,
  state,
  inputLabel,
  timeLabel,
  outputLabel,
  onOpen,
}: {
  readonly title: string;
  readonly state: ComputationState;
  readonly inputLabel: string;
  readonly timeLabel: string;
  readonly outputLabel: string;
  readonly onOpen: () => void;
}): ReactElement {
  return (
    <article className={styles.listItem}>
      <div className={styles.actions}>
        <h2>{title}</h2>
        <AnalysisStatusChip state={state} />
      </div>
      <p>
        {inputLabel} · {timeLabel} · {outputLabel}
      </p>
      <Button variant="secondary" onClick={onOpen}>
        Open analysis
      </Button>
    </article>
  );
}
