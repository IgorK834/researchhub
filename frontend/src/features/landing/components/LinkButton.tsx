import type { ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  Button,
  type ButtonSize,
  type ButtonVariant,
} from '../../../shared/components/Button';
import type { IconName } from '../../../shared/components/icons';
import { usePublicConfig } from '../../../app/PublicConfig';

/**
 * A design-system Button that is a real link (middle-click and "open in new tab" keep working) but
 * navigates inside the single-page app on a plain click instead of reloading the document.
 */
export function LinkButton({
  to,
  children,
  variant,
  size,
  icon,
  className,
  onNavigate,
}: {
  readonly to: string;
  readonly children: string;
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly icon?: IconName;
  readonly className?: string;
  readonly onNavigate?: () => void;
}): ReactElement | null {
  const navigate = useNavigate();
  const { config } = usePublicConfig();
  if (to === '/register' && config?.registrationMode !== 'open') return null;
  return (
    <Button
      href={to}
      {...(variant === undefined ? {} : { variant })}
      {...(size === undefined ? {} : { size })}
      {...(icon === undefined ? {} : { icon })}
      {...(className === undefined ? {} : { className })}
      onClick={(event) => {
        if (
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        )
          return;
        event.preventDefault();
        onNavigate?.();
        void navigate(to);
      }}
    >
      {children}
    </Button>
  );
}
