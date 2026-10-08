import type { ReactElement } from 'react';
import { usePublicConfig, type AiMode } from '../../../app/PublicConfig';
import { Badge } from '../../../shared/components/identity';

export function AiModeChip({ ai }: { readonly ai?: AiMode }): ReactElement {
  const { config } = usePublicConfig();
  const mode = ai ?? config?.ai;
  const label =
    mode === undefined
      ? 'AI mode unavailable'
      : mode.mode === 'deterministic'
        ? 'Fixture AI (deterministic)'
        : `Live model: ${mode.modelName}`;
  return <Badge label={label} icon="sparkle" tone="lavender" />;
}
