import { useLayoutEffect, useRef, type RefObject } from 'react';

interface Entry {
  readonly host: HTMLElement;
  readonly surface: HTMLElement;
  readonly modal: boolean;
}
const stack: Entry[] = [];
const toastHosts = new Set<HTMLElement>();
const previousInert = new Map<HTMLElement, boolean>();
let previousOverflow: string | undefined;
let observer: MutationObserver | undefined;

/** One stack owns inertness/scroll locking, including nested dialogs and popovers. */
function synchronize(): void {
  const modalIndex = stack.map((entry) => entry.modal).lastIndexOf(true);
  const toastTarget = stack[modalIndex]?.surface ?? document.body;
  for (const host of toastHosts) {
    if (host.parentElement === toastTarget) continue;
    const focused = host.contains(document.activeElement)
      ? (document.activeElement as HTMLElement)
      : null;
    toastTarget.append(host);
    host.removeAttribute('inert');
    focused?.focus();
  }
  if (modalIndex < 0) {
    for (const [element, inert] of previousInert) element.toggleAttribute('inert', inert);
    previousInert.clear();
    if (previousOverflow !== undefined) document.body.style.overflow = previousOverflow;
    previousOverflow = undefined;
    observer?.disconnect();
    observer = undefined;
    return;
  }
  if (previousOverflow === undefined) {
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    observer = new MutationObserver(synchronize);
    observer.observe(document.body, { childList: true });
  }
  for (const element of Array.from(document.body.children)) {
    if (!(element instanceof HTMLElement)) continue;
    if (!previousInert.has(element))
      previousInert.set(element, element.hasAttribute('inert'));
    const active = stack.slice(modalIndex).some((entry) => element.contains(entry.host));
    element.toggleAttribute('inert', !active || previousInert.get(element));
  }
}

/** A stable portal root keeps live regions/actions inside the active modal without remounting toasts. */
export function registerToastHost(host: HTMLElement): () => void {
  toastHosts.add(host);
  synchronize();
  return () => {
    toastHosts.delete(host);
    host.remove();
  };
}

function available(element: HTMLElement, host: HTMLElement): boolean {
  if (
    !host.contains(element) ||
    element.matches(':disabled') ||
    element.closest('[hidden], [inert]')
  )
    return false;
  for (
    let ancestor: HTMLElement | null = element;
    ancestor && ancestor !== host.parentElement;
    ancestor = ancestor.parentElement
  ) {
    const style = getComputedStyle(ancestor);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
  }
  return true;
}

export function tabbables(host: HTMLElement): HTMLElement[] {
  return Array.from(
    host.querySelectorAll<HTMLElement>(
      'button, a[href], input, select, textarea, [tabindex]',
    ),
  ).filter((element) => {
    return element.tabIndex >= 0 && available(element, host);
  });
}

interface OverlayOptions {
  readonly open: boolean;
  readonly modal: boolean;
  readonly dismissible: boolean;
  readonly onClose: () => void;
  readonly hostRef: RefObject<HTMLElement | null>;
  readonly surfaceRef: RefObject<HTMLElement | null>;
  readonly triggerRef?: RefObject<HTMLElement | null>;
  readonly initialFocusRef?: RefObject<HTMLElement | null>;
  readonly last?: boolean;
  readonly initialFocusSelector?: string;
}

export function useOverlay({
  open,
  modal,
  dismissible,
  onClose,
  hostRef,
  surfaceRef,
  triggerRef,
  initialFocusRef,
  last = false,
  initialFocusSelector,
}: OverlayOptions): void {
  const close = useRef(onClose);
  useLayoutEffect(() => {
    close.current = onClose;
  }, [onClose]);
  useLayoutEffect(() => {
    if (!open || !hostRef.current || !surfaceRef.current) return;
    const host = hostRef.current;
    const surface = surfaceRef.current;
    const returnTo =
      triggerRef?.current ??
      (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const entry: Entry = { host, surface, modal };
    let restoreFocus = true;
    stack.push(entry);
    synchronize();
    const focusFirst = (): void => {
      const items = initialFocusSelector
        ? Array.from(surface.querySelectorAll<HTMLElement>(initialFocusSelector))
        : tabbables(surface);
      const initial = initialFocusRef?.current;
      (
        (initial && available(initial, surface) ? initial : undefined) ??
        (last ? items.at(-1) : items[0]) ??
        surface
      ).focus();
    };
    focusFirst();
    const top = (): boolean => stack.at(-1) === entry;
    const onKey = (event: KeyboardEvent): void => {
      if (!top()) return;
      if (event.key === 'Escape' && dismissible) {
        event.preventDefault();
        event.stopImmediatePropagation();
        close.current();
      } else if (event.key === 'Tab' && modal) {
        const items = tabbables(surface);
        const index = items.indexOf(document.activeElement as HTMLElement);
        const next = event.shiftKey
          ? index <= 0
            ? items.length - 1
            : index - 1
          : (index + 1) % items.length;
        event.preventDefault();
        (items[next] ?? surface).focus();
      } else if (event.key === 'Tab') {
        const items = tabbables(surface);
        const index = items.indexOf(document.activeElement as HTMLElement);
        if (
          items.length === 0 ||
          (event.shiftKey ? index <= 0 : index === items.length - 1)
        ) {
          // Closing restores the trigger before the browser advances to its next tab stop.
          // Shift+Tab from the first popup control returns directly to the trigger.
          if (event.shiftKey) event.preventDefault();
          close.current();
        }
      }
    };
    const onPointer = (event: PointerEvent): void => {
      if (
        top() &&
        dismissible &&
        !surface.contains(event.target as Node) &&
        !triggerRef?.current?.contains(event.target as Node)
      )
        close.current();
    };
    const onFocus = (event: FocusEvent): void => {
      if (top() && modal && !host.contains(event.target as Node)) focusFirst();
      else if (
        top() &&
        !modal &&
        !host.contains(event.target as Node) &&
        event.target !== triggerRef?.current
      ) {
        restoreFocus = false;
        close.current();
      }
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('focusin', onFocus);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('focusin', onFocus);
      stack.splice(stack.indexOf(entry), 1);
      synchronize();
      if (restoreFocus && returnTo?.isConnected && !returnTo.closest('[inert]'))
        returnTo.focus();
    };
  }, [
    open,
    modal,
    dismissible,
    hostRef,
    surfaceRef,
    triggerRef,
    initialFocusRef,
    last,
    initialFocusSelector,
  ]);
}
