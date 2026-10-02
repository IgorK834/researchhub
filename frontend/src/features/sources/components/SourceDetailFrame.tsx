import { useState, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ToolShell } from '../../../shared/components/shell';
import styles from './SourceDetail.module.css';

/** Keep preview state alive when the source reader moves into the library's slide-over. */
export function SourceDetailFrame({
  embedded,
  header,
  metadata,
  children,
}: {
  readonly embedded: boolean;
  readonly header: ReactNode;
  readonly metadata: ReactNode;
  readonly children: ReactNode;
}): ReactElement {
  const [host] = useState(() => document.createElement('div'));
  const attach = (element: HTMLDivElement | null): void => {
    if (element) element.appendChild(host);
  };
  const content = (
    <div className={styles.content}>
      {header}
      {embedded ? metadata : null}
      <div ref={attach} />
    </div>
  );
  return (
    <>
      {embedded ? (
        content
      ) : (
        <ToolShell
          label="Source reader"
          contextTitle="Source metadata"
          context={metadata}
        >
          {content}
        </ToolShell>
      )}
      {createPortal(<div className={styles.sections}>{children}</div>, host)}
    </>
  );
}
