import { useRef, useState, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { useNarrowDesktop } from '../../hooks/useNarrowDesktop';
import { Button } from '../Button';
import { SlideOver } from '../overlays';
import styles from './ToolShell.module.css';

export interface ToolShellProps {
  readonly contextOpen?: boolean;
  readonly onContextOpenChange?: (open: boolean) => void;
  readonly children: ReactNode;
  readonly label: string;
  readonly secondary?: ReactNode;
  readonly secondaryLabel?: string;
  readonly secondaryWidth?: 240 | 260 | 280;
  readonly context?: ReactNode;
  readonly contextTitle?: string;
  readonly contextFooter?: ReactNode;
  readonly contextMode?: 'auto' | 'docked' | 'slide-over';
}

/** Mounted in AppShell's single main landmark; the app supplies its 64px navigation rail. */
export function ToolShell({
  children,
  label,
  secondary,
  secondaryLabel = 'Tool navigation',
  secondaryWidth = 260,
  context,
  contextTitle = 'Context panel',
  contextFooter,
  contextMode = 'auto',
  contextOpen,
  onContextOpenChange,
}: ToolShellProps): ReactElement {
  return (
    <div className={styles.tool} data-secondary-width={secondaryWidth}>
      {secondary === undefined ? null : (
        <nav aria-label={secondaryLabel} className={styles.secondary}>
          {secondary}
        </nav>
      )}
      <section aria-label={label} className={styles.main}>
        {children}
      </section>
      {context === undefined ? null : (
        <ContextPanel
          title={contextTitle}
          footer={contextFooter}
          mode={contextMode}
          controlledOpen={contextOpen}
          onOpenChange={onContextOpenChange}
        >
          {context}
        </ContextPanel>
      )}
    </div>
  );
}

function ContextPanel({
  title,
  footer,
  mode,
  children,
  controlledOpen,
  onOpenChange,
}: {
  readonly controlledOpen?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  readonly title: string;
  readonly footer?: ReactNode;
  readonly mode: NonNullable<ToolShellProps['contextMode']>;
  readonly children: ReactNode;
}): ReactElement {
  const narrow = useNarrowDesktop();
  const sliding = mode === 'slide-over' || (mode === 'auto' && narrow);
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  const setOpen = (value: boolean): void => {
    setLocalOpen(value);
    onOpenChange?.(value);
  };
  const trigger = useRef<HTMLButtonElement>(null);
  // A stable portal container keeps drafts, requests and focusable inputs alive across dock changes.
  const [host] = useState(() => document.createElement('div'));
  const [footerHost] = useState(() => document.createElement('div'));
  const attachFooter = (element: HTMLDivElement | null): void => {
    if (element) element.appendChild(footerHost);
  };
  const attach = (element: HTMLDivElement | null): void => {
    if (element) element.appendChild(host);
  };
  return (
    <>
      {sliding ? (
        <>
          <Button
            ref={trigger}
            className={styles.contextTrigger}
            variant="secondary"
            icon="panel"
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={() => setOpen(true)}
          >
            Open {title.toLocaleLowerCase()}
          </Button>
          <SlideOver
            open={open}
            onClose={() => setOpen(false)}
            title={title}
            returnFocusRef={controlledOpen === undefined ? trigger : undefined}
            footer={footer === undefined ? undefined : <div ref={attachFooter} />}
          >
            <div ref={attach} />
          </SlideOver>
        </>
      ) : (
        <aside aria-label={title} className={styles.context}>
          <div className={styles.contextContents}>
            <div ref={attach} className={styles.contextBody} />
            {footer === undefined ? null : (
              <footer className={styles.contextFooter}>
                <div ref={attachFooter} />
              </footer>
            )}
          </div>
        </aside>
      )}
      {createPortal(children, host)}
      {createPortal(footer, footerHost)}
    </>
  );
}
