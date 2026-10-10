import { useMemo, useRef, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { useOverlay } from './useOverlay';
import { usePosition, type MenuItem, type VirtualAnchor } from './Popover';
import { Icon } from '../icons';
import styles from './Overlays.module.css';

/** A screen anchor is independent of the logical document selection. */
export function VirtualMenu({
  anchor,
  returnTo,
  items,
  onClose,
  label,
}: {
  readonly anchor: VirtualAnchor;
  readonly returnTo: HTMLElement;
  readonly items: readonly MenuItem[];
  readonly onClose: () => void;
  readonly label: string;
}): ReactElement {
  const virtual = useMemo(() => ({ current: anchor }), [anchor]);
  const trigger = useMemo(() => ({ current: returnTo }), [returnTo]);
  const host = useRef<HTMLDivElement>(null),
    surface = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<string>();
  useOverlay({
    open: true,
    modal: false,
    dismissible: true,
    onClose,
    hostRef: host,
    surfaceRef: surface,
    triggerRef: trigger,
    initialFocusSelector: '[role="menuitem"]:not(:disabled)',
  });
  usePosition(true, virtual, surface);
  const enabled = items.filter((item) => !item.disabled);
  return createPortal(
    <div ref={host} className={styles.popoverLayer} data-rh-overlay="">
      <div
        ref={surface}
        role="menu"
        aria-label={label}
        tabIndex={-1}
        className={styles.menu}
        onKeyDown={(event) => {
          if (event.key === 'Tab') {
            onClose();
            return;
          }
          const index = enabled.findIndex((item) => item.id === active);
          let next: MenuItem | undefined;
          if (event.key === 'ArrowDown') next = enabled[(index + 1) % enabled.length];
          if (event.key === 'ArrowUp')
            next = enabled[(index - 1 + enabled.length) % enabled.length];
          if (event.key === 'Home') next = enabled[0];
          if (event.key === 'End') next = enabled.at(-1);
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
                onClose();
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
    returnTo.closest('[data-rh-overlay-surface]') ?? document.body,
  );
}
