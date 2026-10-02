import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  ReactElement,
  ReactNode,
  Ref,
} from 'react';

import { Icon, type IconName } from './icons';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-soft';
export type ButtonSize = 'compact' | 'default' | 'large';

type Content =
  | { readonly iconOnly?: false; readonly icon?: IconName; readonly children: ReactNode }
  | {
      readonly iconOnly: true;
      readonly icon: IconName;
      readonly children?: never;
      /** Non-empty action name, e.g. "Download source"; never just the icon name. */
      readonly 'aria-label': string;
    };

interface SharedProps {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly busy?: boolean;
  /** Optional visible progress text; the original action remains the accessible name. */
  readonly busyLabel?: string;
  readonly disabled?: boolean;
}

type NativeButton = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  readonly href?: never;
  readonly ref?: Ref<HTMLButtonElement>;
};
type NativeLink = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'children' | 'href'> & {
  readonly href: string;
  readonly type?: never;
  readonly ref?: Ref<HTMLAnchorElement>;
};

export type ButtonProps = SharedProps & Content & (NativeButton | NativeLink);

/** Native button by default; an explicit href renders a native link. */
export function Button({
  variant = 'primary',
  size = 'default',
  busy = false,
  busyLabel,
  disabled = false,
  iconOnly = false,
  icon,
  children,
  className,
  ...nativeProps
}: ButtonProps): ReactElement {
  if (iconOnly && !nativeProps['aria-label']?.trim()) {
    throw new Error('An icon-only Button requires a non-empty aria-label.');
  }

  const unavailable = disabled || busy;
  const classes = [
    styles.button,
    styles[variant],
    styles[size],
    iconOnly ? styles.iconOnly : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const content = (
    <>
      {/* Original content always participates in layout, including while busy. */}
      <span className={styles.content}>
        {icon ? <Icon name={icon} size={16} /> : null}
        {children}
      </span>
      {busy ? (
        <span className={styles.busy} aria-hidden="true">
          <Icon name="refresh" size={16} className={styles.spinner} />
          {!iconOnly ? busyLabel : null}
        </span>
      ) : null}
    </>
  );

  const accessibility = {
    'aria-busy': busy || undefined,
  };

  if (nativeProps.href !== undefined) {
    const { href, onClick, tabIndex, ...linkProps } = nativeProps as NativeLink;
    return (
      <a
        {...linkProps}
        {...accessibility}
        className={classes}
        href={unavailable ? undefined : href}
        role={unavailable ? 'link' : undefined}
        aria-disabled={unavailable || undefined}
        tabIndex={unavailable ? -1 : tabIndex}
        data-busy={busy || undefined}
        onClick={(event) => {
          if (unavailable) {
            event.preventDefault();
            return;
          }
          onClick?.(event);
        }}
      >
        {content}
      </a>
    );
  }

  const { type = 'button', ...buttonProps } = nativeProps as NativeButton;
  return (
    <button
      {...buttonProps}
      {...accessibility}
      type={type}
      className={classes}
      disabled={unavailable}
      data-busy={busy || undefined}
    >
      {content}
    </button>
  );
}
