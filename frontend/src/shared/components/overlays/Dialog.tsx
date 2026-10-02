import { useId, useRef, type ReactElement, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

import { Button } from '../Button';
import { useOverlay } from './useOverlay';
import styles from './Overlays.module.css';

export interface DialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly description?: string;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
  /** False for a confirmation that must be dismissed explicitly. Close remains available. */
  readonly dismissible?: boolean;
  readonly initialFocusRef?: RefObject<HTMLElement | null>;
  readonly returnFocusRef?: RefObject<HTMLElement | null>;
  readonly closeLabel?: string;
  readonly className?: string;
}

function ModalSurface({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  dismissible = true,
  initialFocusRef,
  returnFocusRef,
  closeLabel = 'Close',
  className,
  slideOver,
}: DialogProps & { readonly slideOver: boolean }): ReactElement | null {
  const id = useId();
  const hostRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLElement>(null);
  useOverlay({
    open,
    onClose,
    modal: true,
    dismissible,
    hostRef,
    surfaceRef,
    triggerRef: returnFocusRef,
    initialFocusRef,
  });
  if (!open) return null;
  return createPortal(
    <div
      ref={hostRef}
      className={slideOver ? styles.slideLayer : styles.modalLayer}
      data-rh-overlay=""
    >
      <section
        ref={surfaceRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={description ? `${id}-description` : undefined}
        tabIndex={-1}
        className={[slideOver ? styles.slideOver : styles.dialog, className]
          .filter(Boolean)
          .join(' ')}
        data-rh-overlay-surface=""
      >
        <header className={styles.header}>
          <div>
            <h2 id={`${id}-title`}>{title}</h2>
            {description ? <p id={`${id}-description`}>{description}</p> : null}
          </div>
          <Button
            variant="ghost"
            iconOnly
            icon="x"
            aria-label={closeLabel}
            onClick={onClose}
          />
        </header>
        <div className={styles.body}>{children}</div>
        {footer ? <footer className={styles.footer}>{footer}</footer> : null}
      </section>
    </div>,
    document.body,
  );
}

export function Dialog(props: DialogProps): ReactElement | null {
  return <ModalSurface {...props} slideOver={false} />;
}
export function SlideOver(props: DialogProps): ReactElement | null {
  return <ModalSurface {...props} slideOver />;
}
