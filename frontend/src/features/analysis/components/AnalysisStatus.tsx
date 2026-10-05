import type { ReactElement } from 'react';
import { Icon, type IconName } from '../../../shared/components/icons';
import type { AnalysisStatus as Status } from '../api/analysisApi';
import styles from './Analysis.module.css';
import { AnalysisStatusChip } from './AnalysisWidgets';

const STATES: Record<
  Status,
  { readonly label: string; readonly icon: IconName; readonly tone: string }
> = {
  DRAFT: { label: 'Draft', icon: 'pencil', tone: 'neutral' },
  PLANNING: { label: 'Preparing', icon: 'refresh', tone: 'active' },
  READY_TO_EXECUTE: { label: 'Ready to run', icon: 'play', tone: 'neutral' },
  QUEUED: { label: 'Queued', icon: 'clock', tone: 'active' },
  RUNNING: { label: 'Running', icon: 'refresh', tone: 'active' },
  SUCCEEDED: { label: 'Completed', icon: 'check', tone: 'success' },
  FAILED: { label: 'Failed', icon: 'alert', tone: 'failed' },
};
export function AnalysisStatus({ status }: { readonly status: Status }): ReactElement {
  if (['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED'].includes(status))
    return (
      <AnalysisStatusChip
        state={
          status === 'SUCCEEDED'
            ? 'COMPLETED'
            : (status as 'QUEUED' | 'RUNNING' | 'FAILED')
        }
      />
    );
  const state = STATES[status] ?? { label: status, icon: 'info', tone: 'neutral' };
  return (
    <span className={styles.status} data-tone={state.tone}>
      <Icon name={state.icon} size={14} />
      {state.label}
    </span>
  );
}
