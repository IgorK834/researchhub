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
  const narrow = useNarrowDesktop();
  const [host] = useState(() => document.createElement('div'));
  const attach = (element: HTMLDivElement | null): void => {
    if (element) element.appendChild(host);
  };
  return (
    <>
      {narrow ? (
        <Popover triggerLabel="Filters" title="Filters">
          <div ref={attach} />
        </Popover>
      ) : (
        <div ref={attach} />
      )}
      {createPortal(children, host)}
    </>
  );
}
