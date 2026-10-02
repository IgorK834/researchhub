import { forwardRef, type ReactNode } from 'react';
import styles from './CitationChip.module.css';

export type CitationVariant = 'document' | 'dataset' | 'analysis';
export const CitationChip = forwardRef<
  HTMLAnchorElement,
  {
    readonly number: string | number;
    readonly variant?: CitationVariant;
    readonly href: string;
    readonly label?: string;
    readonly children?: ReactNode;
    readonly expanded: boolean;
    readonly inline?: boolean;
    readonly onOpen: (anchor: HTMLAnchorElement) => void;
  }
>(function CitationChip(
  { number, variant = 'document', href, label, children, expanded, inline, onOpen },
  ref,
) {
  return (
    <a
      ref={ref}
      href={href}
      role={inline ? 'button' : undefined}
      className={[styles.chip, styles[variant]].join(' ')}
      aria-label={label}
      aria-haspopup="dialog"
      aria-expanded={expanded}
      onClick={(event) => {
        event.preventDefault();
        onOpen(event.currentTarget);
      }}
      onKeyDown={(event) => {
        if (event.key === ' ') {
          event.preventDefault();
          onOpen(event.currentTarget);
        }
      }}
    >
      {children ?? <span>{number}</span>}
    </a>
  );
});
