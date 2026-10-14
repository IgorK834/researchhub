import { t as uiText } from '../../../shared/i18n';
import type { ReactElement } from 'react';
import { Icon, type IconName } from '../../../shared/components/icons';
import type { AnalysisStatus as Status } from '../api/analysisApi';
import styles from './Analysis.module.css';
import { AnalysisStatusChip } from './AnalysisWidgets';

const STATES: Record<
  Status,
  { readonly label: string; readonly icon: IconName; readonly tone: string }
> = {
  DRAFT: {
    get label() {
      return uiText('ui.AnalysisStatus.message001');
    },
    icon: 'pencil',
    tone: 'neutral',
  },
  PLANNING: {
    get label() {
      return uiText('ui.AnalysisStatus.message002');
    },
    icon: 'refresh',
    tone: 'active',
  },
  READY_TO_EXECUTE: {
    get label() {
      return uiText('ui.AnalysisStatus.message003');
    },
    icon: 'play',
    tone: 'neutral',
  },
  QUEUED: {
    get label() {
      return uiText('ui.AnalysisStatus.message004');
    },
    icon: 'clock',
    tone: 'active',
  },
  RUNNING: {
    get label() {
      return uiText('ui.AnalysisStatus.message005');
    },
    icon: 'refresh',
    tone: 'active',
  },
  SUCCEEDED: {
    get label() {
      return uiText('ui.AnalysisStatus.message006');
    },
    icon: 'check',
    tone: 'success',
  },
  FAILED: {
    get label() {
      return uiText('ui.AnalysisStatus.message007');
    },
    icon: 'alert',
    tone: 'failed',
  },
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
