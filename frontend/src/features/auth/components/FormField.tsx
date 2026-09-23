import type { ReactElement } from 'react';

interface FormFieldProps {
  readonly id: string;
  readonly label: string;
  readonly type: 'text' | 'email' | 'password';
  readonly value: string;
  readonly autoComplete: string;
  readonly error?: string | undefined;
  readonly onChange: (value: string) => void;
}

/**
 * A labelled input that reports its own validation message.
 *
 * The error is wired to the input with `aria-describedby` and flagged with `aria-invalid`, so a screen
 * reader announces the problem when focus reaches the field instead of leaving it as colour-coded text
 * only sighted users notice.
 */
export function FormField({
  id,
  label,
  type,
  value,
  autoComplete,
  error,
  onChange,
}: FormFieldProps): ReactElement {
  const errorId = `${id}-error`;
  const hasError = error !== undefined;

  return (
    <p>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        name={id}
        type={type}
        value={value}
        autoComplete={autoComplete}
        aria-invalid={hasError}
        {...(hasError ? { 'aria-describedby': errorId } : {})}
        onChange={(event) => onChange(event.target.value)}
      />
      {hasError ? <span id={errorId}>{error}</span> : null}
    </p>
  );
}
