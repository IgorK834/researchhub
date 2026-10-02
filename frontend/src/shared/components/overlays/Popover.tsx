import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';

import { Button } from '../Button';
import { Icon, type IconName } from '../icons';
import { useOverlay } from './useOverlay';
import styles from './Overlays.module.css';

function usePosition(
  open: boolean,
  trigger: RefObject<HTMLButtonElement | null>,
  surface: RefObject<HTMLDivElement | null>,
): void {
  useLayoutEffect(() => {
    if (!open) return;
    const position = (): void => {
      if (!trigger.current || !surface.current) return;
      const anchor = trigger.current.getBoundingClientRect();
      const popup = surface.current.getBoundingClientRect();
      const gap = 8;
      const left = Math.max(
        gap,
        Math.min(anchor.left, window.innerWidth - popup.width - gap),
      );
      const top =
        anchor.bottom + gap + popup.height <= window.innerHeight
          ? anchor.bottom + gap
          : Math.max(gap, anchor.top - popup.height - gap);
      surface.current.style.setProperty('left', `${left}px`);
      surface.current.style.setProperty('top', `${top}px`);
    };
    position();
    const resize = new ResizeObserver(position);
    if (surface.current) resize.observe(surface.current);
    if (trigger.current) resize.observe(trigger.current);
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    return () => {
      resize.disconnect();
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
    };
  }, [open, trigger, surface]);
}

export interface PopoverProps {
  readonly triggerLabel: string;
  readonly title: string;
  readonly children: ReactNode;
}
/** Non-modal content surface. Tab uses the document sequence; Escape and outside clicks close it. */
export function Popover({ triggerLabel, title, children }: PopoverProps): ReactElement {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<Element | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  useOverlay({
    open,
    onClose: () => setOpen(false),
    modal: false,
    dismissible: true,
    triggerRef: trigger,
    hostRef: host,
    surfaceRef: surface,
  });
  usePosition(open, trigger, surface);
  return (
    <>
      <Button
        ref={trigger}
        variant="secondary"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={(event) => {
          setTarget(event.currentTarget.closest('[data-rh-overlay-surface]'));
          setOpen(!open);
        }}
      >
        {triggerLabel}
      </Button>
      {open
        ? createPortal(
            <div ref={host} className={styles.popoverLayer} data-rh-overlay="">
              <div
                ref={surface}
                id={id}
                role="dialog"
                aria-label={title}
                tabIndex={-1}
                className={styles.popover}
              >
                <header className={styles.popoverHeader}>
                  <strong>{title}</strong>
                  <Button
                    variant="ghost"
                    iconOnly
                    icon="x"
                    aria-label={`Close ${title}`}
                    onClick={() => setOpen(false)}
                  />
                </header>
                {children}
              </div>
            </div>,
            target ?? document.body,
          )
        : null}
    </>
  );
}

export interface MenuItem {
  readonly id: string;
  readonly label: string;
  readonly icon?: IconName;
  readonly shortcut?: string;
  readonly destructive?: boolean;
  readonly disabled?: boolean;
  readonly separatorBefore?: boolean;
  readonly onSelect: () => void;
}
export interface MenuProps {
  readonly label: string;
  readonly items: readonly MenuItem[];
  readonly disabled?: boolean;
  readonly triggerIcon?: IconName;
}

export function Menu({
  label,
  items,
  disabled = false,
  triggerIcon,
}: MenuProps): ReactElement {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<Element | null>(null);
  const [last, setLast] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<string | undefined>();
  const search = useRef('');
  const lastTyped = useRef(0);
  useOverlay({
    open,
    onClose: () => setOpen(false),
    modal: false,
    dismissible: true,
    hostRef: host,
    surfaceRef: surface,
    triggerRef: trigger,
    last,
    initialFocusSelector: '[role="menuitem"]:not(:disabled)',
  });
  usePosition(open, trigger, surface);
  const enabled = items.filter((item) => !item.disabled);
  const triggerContent =
    triggerIcon === undefined
      ? {
          children: (
            <>
              {label}
              <Icon name="chevDown" />
            </>
          ),
        }
      : { iconOnly: true as const, icon: triggerIcon, 'aria-label': label };
  return (
    <>
      <Button
        ref={trigger}
        {...triggerContent}
        variant="secondary"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={(event) => {
          setTarget(event.currentTarget.closest('[data-rh-overlay-surface]'));
          setLast(false);
          setOpen(!open);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setTarget(event.currentTarget.closest('[data-rh-overlay-surface]'));
            setLast(event.key === 'ArrowUp');
            setOpen(true);
          }
        }}
      />
      {open
        ? createPortal(
            <div ref={host} className={styles.popoverLayer} data-rh-overlay="">
              <div
                ref={surface}
                id={id}
                role="menu"
                aria-label={label}
                tabIndex={-1}
                className={styles.menu}
                onKeyDown={(event) => {
                  if (event.key === 'Tab') {
                    setOpen(false);
                    return;
                  }
                  if (enabled.length === 0) return;
                  const index = enabled.findIndex((item) => item.id === active);
                  let next: MenuItem | undefined;
                  if (event.key === 'ArrowDown')
                    next = enabled[(index + 1) % enabled.length];
                  else if (event.key === 'ArrowUp')
                    next = enabled[(index - 1 + enabled.length) % enabled.length];
                  else if (event.key === 'Home') next = enabled[0];
                  else if (event.key === 'End') next = enabled.at(-1);
                  else if (
                    event.key.length === 1 &&
                    !event.ctrlKey &&
                    !event.metaKey &&
                    !event.altKey &&
                    event.key !== ' '
                  ) {
                    const now = Date.now();
                    search.current =
                      now - lastTyped.current > 500
                        ? event.key.toLowerCase()
                        : search.current + event.key.toLowerCase();
                    lastTyped.current = now;
                    if (
                      Array.from(search.current).every(
                        (letter) => letter === search.current[0],
                      )
                    )
                      search.current = search.current[0]!;
                    const ordered = [
                      ...enabled.slice(index + 1),
                      ...enabled.slice(0, index + 1),
                    ];
                    next = ordered.find((item) =>
                      item.label.toLowerCase().startsWith(search.current),
                    );
                  }
                  if (next) {
                    event.preventDefault();
                    surface.current
                      ?.querySelector<HTMLButtonElement>(
                        `[data-menu-index="${items.indexOf(next)}"]`,
                      )
                      ?.focus();
                  }
                }}
              >
                {items.map((item, index) => (
                  <div key={item.id} role="none">
                    {item.separatorBefore ? (
                      <div role="separator" className={styles.separator} />
                    ) : null}
                    <button
                      type="button"
                      role="menuitem"
                      data-menu-index={index}
                      disabled={item.disabled}
                      tabIndex={active === item.id ? 0 : -1}
                      className={[
                        styles.menuItem,
                        item.destructive ? styles.destructive : '',
                      ].join(' ')}
                      onFocus={() => setActive(item.id)}
                      onClick={() => {
                        setOpen(false);
                        item.onSelect();
                      }}
                    >
                      {item.icon ? <Icon name={item.icon} /> : null}
                      <span>{item.label}</span>
                      {item.shortcut ? (
                        <span className={styles.shortcut} aria-hidden="true">
                          {item.shortcut}
                        </span>
                      ) : null}
                    </button>
                  </div>
                ))}
              </div>
            </div>,
            target ?? document.body,
          )
        : null}
    </>
  );
}
