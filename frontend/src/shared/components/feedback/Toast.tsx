import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

import { Button } from '../Button';
import { Icon } from '../icons';
import type { IconName } from '../icons';
import { registerToastHost } from '../overlays/useOverlay';
import styles from './Feedback.module.css';

export interface ToastAction {
  readonly label: string;
  readonly onClick: () => void;
}
interface ToastBase {
  readonly title: string;
  readonly message: string;
}
export type ToastInput = ToastBase &
  (
    | {
        readonly tone: 'success' | 'info';
        readonly icon?: IconName;
        readonly action?: ToastAction;
        /** 0 keeps it until dismissed. */ readonly duration?: number;
      }
    | {
        readonly tone: 'blocking';
        readonly action: ToastAction;
        readonly duration?: never;
      }
  );
export interface ToastEntry {
  readonly id: number;
  readonly input: ToastInput;
}
export interface ToastApi {
  readonly showToast: (input: ToastInput) => number;
  readonly dismissToast: (id: number) => void;
}
const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (context === null) throw new Error('useToast must be used inside ToastProvider.');
  return context;
}

function ToastItem({
  entry: { id, input },
  dismiss,
}: {
  readonly entry: ToastEntry;
  readonly dismiss: (id: number) => void;
}): ReactElement {
  const [paused, setPaused] = useState(false);
  const pointerInside = useRef(false);
  const focusInside = useRef(false);
  const remaining = useRef(input.tone !== 'blocking' ? (input.duration ?? 5000) : 0);
  useEffect(() => {
    if (paused || remaining.current === 0) return;
    const started = Date.now();
    const timer = window.setTimeout(() => dismiss(id), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(1, remaining.current - (Date.now() - started));
    };
  }, [paused, id, dismiss]);
  return (
    <div
      className={[
        styles.toast,
        input.tone === 'blocking'
          ? styles.blocking
          : input.tone === 'info'
            ? styles.infoToast
            : styles.successToast,
      ].join(' ')}
      onPointerEnter={() => {
        pointerInside.current = true;
        setPaused(true);
      }}
      onPointerLeave={() => {
        pointerInside.current = false;
        setPaused(focusInside.current);
      }}
      onFocus={() => {
        focusInside.current = true;
        setPaused(true);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          focusInside.current = false;
          setPaused(pointerInside.current);
        }
      }}
    >
      <span className={styles.toastIcon}>
        <Icon
          name={
            input.tone === 'blocking'
              ? 'alert'
              : (input.icon ?? (input.tone === 'success' ? 'check' : 'info'))
          }
          size={16}
        />
      </span>
      <div className={styles.message}>
        <strong>{input.title}</strong>
        <span>{input.message}</span>
      </div>
      {input.action ? (
        <button
          type="button"
          className={styles.toastAction}
          onClick={input.action.onClick}
        >
          {input.action.label}
        </button>
      ) : null}
      <Button
        variant="ghost"
        iconOnly
        icon="x"
        aria-label={`Dismiss ${input.title}`}
        className={styles.dismiss}
        onClick={() => dismiss(id)}
      />
    </div>
  );
}

/** Persistent live regions precede inserted toast content. Blocking toasts never expire. */
export function ToastHost({
  entries,
  dismiss,
}: {
  readonly entries: readonly ToastEntry[];
  readonly dismiss: (id: number) => void;
}): ReactElement {
  const [portalRoot] = useState(() => document.createElement('div'));
  useLayoutEffect(() => registerToastHost(portalRoot), [portalRoot]);
  return createPortal(
    <section aria-label="Notifications" className={styles.toastHost}>
      <div role="status" aria-live="polite" aria-atomic="false">
        {entries
          .filter((entry) => entry.input.tone !== 'blocking')
          .map((entry) => (
            <ToastItem key={entry.id} entry={entry} dismiss={dismiss} />
          ))}
      </div>
      <div role="alert" aria-live="assertive" aria-atomic="false">
        {entries
          .filter((entry) => entry.input.tone === 'blocking')
          .map((entry) => (
            <ToastItem key={entry.id} entry={entry} dismiss={dismiss} />
          ))}
      </div>
    </section>,
    portalRoot,
  );
}

export function ToastProvider({
  children,
}: {
  readonly children: ReactNode;
}): ReactElement {
  const [entries, setEntries] = useState<readonly ToastEntry[]>([]);
  const sequence = useRef(0);
  const dismissToast = useCallback((id: number): void => {
    setEntries((current) => current.filter((entry) => entry.id !== id));
  }, []);
  const showToast = useCallback((input: ToastInput): number => {
    if (
      !input.title.trim() ||
      !input.message.trim() ||
      (input.action && !input.action.label.trim())
    )
      throw new Error('A toast needs a title, message and named action.');
    if (
      input.tone !== 'blocking' &&
      input.duration !== undefined &&
      (!Number.isFinite(input.duration) || input.duration < 0)
    )
      throw new Error('Toast duration must be a finite non-negative number.');
    const id = ++sequence.current;
    setEntries((current) => [...current, { id, input }]);
    return id;
  }, []);
  return (
    <ToastContext.Provider value={{ showToast, dismissToast }}>
      {children}
      <ToastHost entries={entries} dismiss={dismissToast} />
    </ToastContext.Provider>
  );
}
