import { t as uiText, useLocale as useUiLocale } from '../../../shared/i18n';
import type { ReactElement } from 'react';
import { usePublicConfig, type AiMode } from '../../../app/PublicConfig';
import { Badge } from '../../../shared/components/identity';

export function AiModeChip({ ai }: { readonly ai?: AiMode }): ReactElement {
  useUiLocale();
  const { config } = usePublicConfig();
  const mode = ai ?? config?.ai;
  const label =
    mode === undefined
      ? uiText('ui.AiModeChip.message001')
      : mode.mode === 'deterministic'
        ? uiText('ui.AiModeChip.message002')
        : uiText('ui.GroundedAnswer.message008', { value0: mode.modelName });
  return <Badge label={label} icon="sparkle" tone="lavender" />;
}
