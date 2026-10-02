import {
  useId,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type Ref,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

import { Icon, type IconName } from '../icons';
import styles from './Forms.module.css';

export interface FieldProps {
  readonly id?: string;
  readonly label: string;
  readonly hint?: ReactNode;
  /** The server's field message is rendered verbatim. */
  readonly error?: string;
}

export function useField({ id, hint, error }: FieldProps, describedBy?: string) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const hintId = hint !== undefined && hint !== null ? `${fieldId}-hint` : undefined;
  const errorId = error !== undefined ? `${fieldId}-error` : undefined;
  return {
    id: fieldId,
    hintId,
    errorId,
    'aria-describedby':
      [describedBy, hintId, errorId].filter(Boolean).join(' ') || undefined,
    'aria-invalid': error !== undefined,
  };
}

export function FieldMessages({
  hint,
  error,
  hintId,
  errorId,
}: Pick<FieldProps, 'hint' | 'error'> & {
  readonly hintId?: string;
  readonly errorId?: string;
}): ReactElement {
  return (
    <>
      {hint !== undefined && hint !== null ? (
        <span id={hintId} className={styles.hint}>
          {hint}
        </span>
      ) : null}
      {error !== undefined ? (
        <span id={errorId} className={styles.error}>
          <Icon name="alert" size={14} />
          {error}
        </span>
      ) : null}
    </>
  );
}

function FieldShell({
  label,
  hint,
  error,
  id,
  hintId,
  errorId,
  children,
}: FieldProps & {
  readonly id: string;
  readonly hintId?: string;
  readonly errorId?: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      {children}
      <FieldMessages hint={hint} error={error} hintId={hintId} errorId={errorId} />
    </div>
  );
}

export type TextFieldProps = FieldProps &
  Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'type' | 'size'> & {
    readonly type?: 'text' | 'email' | 'password' | 'search' | 'tel' | 'url' | 'number';
    readonly size?: 'default' | 'large';
    readonly icon?: IconName;
    /** A visual shortcut hint. The consumer registers the shortcut, if any. */
    readonly keycap?: string;
    readonly ref?: Ref<HTMLInputElement>;
  };

export function TextField({
  label,
  hint,
  error,
  id,
  type = 'text',
  size = 'default',
  icon,
  keycap,
  className,
  ...native
}: TextFieldProps): ReactElement {
  const field = useField({ id, label, hint, error }, native['aria-describedby']);
  const leadingIcon = icon ?? (type === 'search' ? 'search' : undefined);
  return (
    <FieldShell label={label} hint={hint} error={error} {...field}>
      <div className={styles.chrome}>
        {leadingIcon ? (
          <span className={styles.leading}>
            <Icon name={leadingIcon} />
          </span>
        ) : null}
        <input
          {...native}
          id={field.id}
          type={type}
          aria-describedby={field['aria-describedby']}
          aria-invalid={field['aria-invalid'] || native['aria-invalid'] || false}
          className={[
            styles.control,
            styles[size],
            leadingIcon ? styles.withIcon : '',
            keycap ? styles.withKeycap : '',
            className,
          ]
            .filter(Boolean)
            .join(' ')}
        />
        {keycap ? (
          <kbd className={styles.keycap} aria-hidden="true">
            {keycap}
          </kbd>
        ) : null}
      </div>
    </FieldShell>
  );
}

export type TextareaProps = FieldProps &
  Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> & {
    readonly ref?: Ref<HTMLTextAreaElement>;
  };
export function Textarea({
  label,
  hint,
  error,
  id,
  className,
  ...native
}: TextareaProps): ReactElement {
  const field = useField({ id, label, hint, error }, native['aria-describedby']);
  return (
    <FieldShell label={label} hint={hint} error={error} {...field}>
      <textarea
        {...native}
        id={field.id}
        aria-describedby={field['aria-describedby']}
        aria-invalid={field['aria-invalid'] || native['aria-invalid'] || false}
        className={[styles.control, styles.textarea, className].filter(Boolean).join(' ')}
      />
    </FieldShell>
  );
}

export type SelectProps = FieldProps &
  Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id' | 'multiple' | 'size'> & {
    readonly ref?: Ref<HTMLSelectElement>;
  };
export function Select({
  label,
  hint,
  error,
  id,
  className,
  children,
  ...native
}: SelectProps): ReactElement {
  const field = useField({ id, label, hint, error }, native['aria-describedby']);
  return (
    <FieldShell label={label} hint={hint} error={error} {...field}>
      <div className={styles.chrome}>
        <select
          {...native}
          id={field.id}
          aria-describedby={field['aria-describedby']}
          aria-invalid={field['aria-invalid'] || native['aria-invalid'] || false}
          className={[styles.control, styles.select, className].filter(Boolean).join(' ')}
        >
          {children}
        </select>
        <span className={styles.trailing}>
          <Icon name="chevDown" />
        </span>
      </div>
    </FieldShell>
  );
}

export type CheckboxProps = FieldProps &
  Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'type'> & {
    readonly ref?: Ref<HTMLInputElement>;
  };
function CheckControl({
  label,
  hint,
  error,
  id,
  className,
  toggle,
  ...native
}: CheckboxProps & { readonly toggle: boolean }): ReactElement {
  const field = useField({ id, label, hint, error }, native['aria-describedby']);
  return (
    <div className={styles.field}>
      <label className={styles.checkLabel} htmlFor={field.id}>
        <span className={styles.checkChrome}>
          <input
            {...native}
            id={field.id}
            type="checkbox"
            role={toggle ? 'switch' : undefined}
            aria-describedby={field['aria-describedby']}
            aria-invalid={field['aria-invalid'] || native['aria-invalid'] || false}
            className={[toggle ? styles.toggle : styles.checkbox, className]
              .filter(Boolean)
              .join(' ')}
          />
          {!toggle ? <Icon name="check" size={14} className={styles.checkmark} /> : null}
        </span>
        {label}
      </label>
      <FieldMessages
        hint={hint}
        error={error}
        hintId={field.hintId}
        errorId={field.errorId}
      />
    </div>
  );
}

export function Checkbox(props: CheckboxProps): ReactElement {
  return <CheckControl {...props} toggle={false} />;
}
export function Toggle(props: CheckboxProps): ReactElement {
  return <CheckControl {...props} toggle />;
}
