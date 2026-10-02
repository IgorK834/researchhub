import type { ReactElement } from 'react';
import { Badge } from './identity';

/** null is the authorized workspace scope; an empty array is an explicit empty scope. */
export function ScopeChip({
  selectedSourceIds,
  readyCount,
  sourceLabel,
  action = 'Ask across',
}: {
  readonly selectedSourceIds: readonly string[] | null;
  readonly readyCount: number;
  readonly sourceLabel?: string;
  readonly action?: string;
}): ReactElement {
  const count = selectedSourceIds === null ? readyCount : selectedSourceIds.length;
  return (
    <Badge
      icon="library"
      tone="blue"
      label={
        sourceLabel ??
        `${action} ${String(count)} ${count === 1 ? 'source' : 'sources'}${selectedSourceIds === null ? ' · All workspace sources' : ' · Selected sources'}`
      }
    />
  );
}
