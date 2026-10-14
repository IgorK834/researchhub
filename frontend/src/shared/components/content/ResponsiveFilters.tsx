import { t as uiText, useLocale as useUiLocale } from '../../i18n';
import { useState, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useNarrowDesktop } from '../../hooks/useNarrowDesktop';
import { Popover } from '../overlays';

/** Layout only: consumers supply their existing filtering controls and own filtering state. */
export function ResponsiveFilters({
  children,
}: {
  readonly children: ReactNode;
}): ReactElement {
  useUiLocale();
  const narrow = useNarrowDesktop();
  const [host] = useState(() => document.createElement('div'));
  const attach = (element: HTMLDivElement | null): void => {
    if (element) element.appendChild(host);
  };
  return (
    <>
      {narrow ? (
        <Popover
          triggerLabel={uiText('ui.ResponsiveFilters.message001')}
          title={uiText('ui.ResponsiveFilters.message001')}
        >
          <div ref={attach} />
        </Popover>
      ) : (
        <div ref={attach} />
      )}
      {createPortal(children, host)}
    </>
  );
}
