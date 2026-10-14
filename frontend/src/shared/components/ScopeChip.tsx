import { t as uiText, useLocale as useUiLocale } from '../i18n';
import type { ReactElement } from 'react';
import { Badge } from './identity';
import styles from './ScopeChip.module.css';

/** null is the authorized workspace scope; an empty array is an explicit empty scope. */
export function ScopeChip({
  selectedSourceIds,
  sourceCount,
  sourceLabel,
  action = uiText('ui.ScopeChip.message003'),
}: {
  readonly selectedSourceIds: readonly string[] | null;
  readonly sourceCount: number;
  readonly sourceLabel?: string;
  readonly action?: string;
}): ReactElement {
  useUiLocale();
  const count = selectedSourceIds === null ? sourceCount : selectedSourceIds.length;
  return (
    <Badge
      className={styles.scope}
      icon="library"
      tone="blue"
      label={
        sourceLabel ??
        `${action} ${String(count)} ${count === 1 ? uiText('ui.DocumentSources.message004') : uiText('ui.AiDraftBlock.message004')}${selectedSourceIds === null ? ' ' + uiText('ui.ScopeChip.message001') : ' ' + uiText('ui.ScopeChip.message002')}`
      }
    />
  );
}
