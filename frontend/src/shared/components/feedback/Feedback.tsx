import type { CSSProperties, ReactElement, ReactNode } from 'react';

import { Icon, type IconName } from '../icons';
import styles from './Feedback.module.css';

export type BannerTone = 'info' | 'warning' | 'error' | 'success' | 'note';
const toneIcons: Record<BannerTone, IconName> = {
  info: 'info',
  warning: 'warn',
  error: 'alert',
  success: 'check',
  note: 'help',
};
interface BannerBase {
  readonly lead: string;
  readonly children?: ReactNode;
  readonly icon?: IconName;
  readonly role?: 'alert' | 'status';
}
export type BannerProps = BannerBase &
  (
    | { readonly tone: 'note'; readonly action?: never }
    | { readonly tone?: Exclude<BannerTone, 'note'>; readonly action?: ReactElement }
  );
export function Banner({
  tone = 'info',
  lead,
  children,
  action,
  icon,
  role,
}: BannerProps): ReactElement {
  if (!lead.trim()) throw new Error('Banner requires a non-empty visible lead.');
  const announcement =
    role ?? (tone === 'error' ? 'alert' : tone === 'note' ? undefined : 'status');
  return (
    <div
      className={[styles.banner, styles[tone]].join(' ')}
      role={announcement}
      aria-live={announcement === 'status' ? 'polite' : undefined}
    >
      <Icon name={icon ?? toneIcons[tone]} size={16} />
      <div className={styles.message}>
        <strong>{lead}</strong>
        {children !== undefined && children !== null ? <span>{children}</span> : null}
      </div>
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  );
}

export type SpinnerProps = {
  readonly size?: 14 | 16 | 20;
  readonly className?: string;
} & (
  | { readonly decorative: true; readonly label?: never }
  | { readonly decorative?: false; readonly label: string }
);
export function Spinner({
  size = 16,
  className,
  decorative = false,
  label,
}: SpinnerProps): ReactElement {
  if (!decorative && !label?.trim())
    throw new Error('Spinner requires a non-empty label.');
  return (
    <span
      role={decorative ? undefined : 'status'}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative || undefined}
      className={[styles.spinner, className].filter(Boolean).join(' ')}
    >
      <Icon name="refresh" size={size} />
      {!decorative ? <span>{label}</span> : null}
    </span>
  );
}

export interface ProgressProps {
  readonly label: string;
  readonly value?: number;
  readonly tone?: 'blue' | 'yellow';
}
export function Progress({ label, value, tone = 'blue' }: ProgressProps): ReactElement {
  if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > 100))
    throw new Error('Progress value must be between 0 and 100.');
  return (
    <div className={styles.progress}>
      <div className={styles.progressLabel}>
        <Icon name={value === 100 ? 'check' : 'upload'} size={14} />
        <span>{label}</span>
        {value !== undefined ? <span>{value}%</span> : null}
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        aria-valuetext={value === undefined ? 'In progress' : `${value}%`}
        className={styles.track}
      >
        <span
          className={[
            styles.fill,
            styles[tone],
            value === undefined ? styles.indeterminate : '',
          ].join(' ')}
          style={{ inlineSize: value === undefined ? '40%' : `${value}%` }}
        />
      </div>
    </div>
  );
}

export interface StepProgressProps {
  readonly steps: readonly string[];
  readonly currentStep: number;
  readonly label: string;
}
/** currentStep is one-based; steps.length + 1 means all steps are complete. */
export function StepProgress({
  steps,
  currentStep,
  label,
}: StepProgressProps): ReactElement {
  if (
    steps.length === 0 ||
    !Number.isInteger(currentStep) ||
    currentStep < 1 ||
    currentStep > steps.length + 1
  )
    throw new Error('StepProgress requires steps and a valid one-based currentStep.');
  const complete = currentStep > steps.length;
  const summary = complete
    ? `Complete · ${label}`
    : `Step ${currentStep} of ${steps.length} · ${label}`;
  return (
    <div className={styles.progress}>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={steps.length}
        aria-valuenow={currentStep - 1}
        aria-valuetext={summary}
        className={styles.steps}
      >
        {steps.map((step, index) => (
          <span
            key={`${index}-${step}`}
            title={step}
            className={[
              styles.step,
              index + 1 < currentStep
                ? styles.done
                : index + 1 === currentStep
                  ? styles.current
                  : '',
            ].join(' ')}
          />
        ))}
      </div>
      <div className={styles.progressLabel}>
        <Icon name={complete ? 'check' : 'refresh'} size={14} />
        <span>{summary}</span>
      </div>
    </div>
  );
}

export interface SkeletonProps {
  /** Known content always wins, even while surrounding content is loading. */
  readonly children?: ReactNode;
  readonly width?: CSSProperties['inlineSize'];
  readonly height?: CSSProperties['blockSize'];
  readonly shape?: 'text' | 'block' | 'circle';
}
export function Skeleton({
  children,
  width = '100%',
  height = 12,
  shape = 'text',
}: SkeletonProps): ReactElement {
  if (children !== undefined && children !== null) return <>{children}</>;
  return (
    <span
      aria-hidden="true"
      className={[styles.skeleton, styles[shape]].join(' ')}
      style={{ inlineSize: width, blockSize: height }}
    />
  );
}
