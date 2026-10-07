import type { ReactElement } from 'react';
import { Badge } from './identity';
import styles from './ScopeChip.module.css';

/** null is the authorized workspace scope; an empty array is an explicit empty scope. */
export function ScopeChip({
  selectedSourceIds,
  sourceCount,
  sourceLabel,
  action = 'Ask across',
}: {
  readonly selectedSourceIds: readonly string[] | null;
  readonly sourceCount: number;
  readonly sourceLabel?: string;
  readonly action?: string;
}): ReactElement {
  const count = selectedSourceIds === null ? sourceCount : selectedSourceIds.length;
  return (
    <Badge
      className={styles.scope}
      icon="library"
      tone="blue"
      label={
        sourceLabel ??
        `${action} ${String(count)} ${count === 1 ? 'source' : 'sources'}${selectedSourceIds === null ? ' · All workspace sources' : ' · Selected sources'}`
      }
    />
  );
}
