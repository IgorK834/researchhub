import type { ReactElement } from 'react';
import { Badge } from '../../../shared/components/identity';
import { Icon } from '../../../shared/components/icons';
import {
  SOURCE_STATUS_LABELS,
  SOURCE_STATUS_VISUALS,
  SOURCE_TYPE_VISUALS,
  type SourceType,
  type SourceStatus,
  type SourceVisual,
} from '../api/sourceTypes';
import styles from './Sources.module.css';

const neutral: SourceVisual = { icon: 'file', tone: 'neutral' };

/** Strings are accepted at the wire boundary so future server values degrade safely. */
export function SourceTypeBadge({
  sourceType,
}: {
  readonly sourceType: string;
}): ReactElement {
  const visual = Object.hasOwn(SOURCE_TYPE_VISUALS, sourceType)
    ? SOURCE_TYPE_VISUALS[sourceType as SourceType]
    : neutral;
  return <Badge label={sourceType.trim() || 'Source'} {...visual} size="compact" />;
}

/** Decorative tile; the adjacent name/type badge supplies its accessible text. */
export function SourceTypeTile({
  sourceType,
  size = 'large',
}: {
  readonly sourceType: string;
  readonly size?: 'default' | 'large';
}): ReactElement {
  const visual = Object.hasOwn(SOURCE_TYPE_VISUALS, sourceType)
    ? SOURCE_TYPE_VISUALS[sourceType as SourceType]
    : neutral;
  return (
    <span
      aria-hidden="true"
      className={[styles.tile, styles[visual.tone], styles[size]].join(' ')}
    >
      <Icon name={visual.icon} size={size === 'large' ? 20 : 16} />
    </span>
  );
}

export function SourceStatusChip({ status }: { readonly status: string }): ReactElement {
  const known = Object.hasOwn(SOURCE_STATUS_LABELS, status);
  return (
    <Badge
      label={
        known
          ? SOURCE_STATUS_LABELS[status as SourceStatus]
          : status.trim() || 'Unknown status'
      }
      {...(known
        ? SOURCE_STATUS_VISUALS[status as SourceStatus]
        : { icon: 'info' as const, tone: 'neutral' as const })}
      size="compact"
    />
  );
}
