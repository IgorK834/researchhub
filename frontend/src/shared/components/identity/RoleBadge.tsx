import type { ReactElement } from 'react';

import { workspaceRoleLabel } from '../../utils/workspaceCapabilities';
import { Badge } from './Identity';

export function RoleBadge({ role }: { readonly role: string }): ReactElement {
  return (
    <Badge
      label={workspaceRoleLabel(role)}
      tone={role === 'OWNER' ? 'ink' : role === 'EDITOR' ? 'lavender' : 'neutral'}
      icon={
        role === 'OWNER'
          ? 'key'
          : role === 'EDITOR'
            ? 'pencil'
            : role === 'VIEWER'
              ? 'eye'
              : 'users'
      }
    />
  );
}
