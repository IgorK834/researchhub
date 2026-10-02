import { type KeyboardEvent, type ReactElement } from 'react';

import { Icon, type IconName } from '../icons';
import { FieldMessages, useField, type FieldProps } from './Fields';
import styles from './Forms.module.css';

export interface Choice<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly description?: string;
  readonly icon?: IconName;
  readonly disabled?: boolean;
}
export interface ChoiceGroupProps<T extends string> extends FieldProps {
  readonly name?: string;
  readonly options: readonly Choice<T>[];
  readonly value: T | undefined;
  readonly onChange: (value: T) => void;
  readonly disabled?: boolean;
  readonly required?: boolean;
  readonly 'aria-describedby'?: string;
}

function ChoiceGroup<T extends string>({
  label,
  hint,
  error,
  id,
  name,
  options,
  value,
  onChange,
  disabled = false,
  required,
  'aria-describedby': describedBy,
  cards,
}: ChoiceGroupProps<T> & { readonly cards: boolean }): ReactElement {
  const field = useField({ label, hint, error, id }, describedBy);
  const enabled = options.filter((option) => !option.disabled);
  const tabValue =
    enabled.find((option) => option.value === value)?.value ?? enabled[0]?.value;
  const navigate = (event: KeyboardEvent<HTMLInputElement>, current: T): void => {
    const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(event.key) || disabled || enabled.length === 0) return;
    event.preventDefault();
    const direction = ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1;
    const index = enabled.findIndex((option) => option.value === current);
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? enabled.length - 1
          : (index + direction + enabled.length) % enabled.length;
    const next = enabled[nextIndex]!;
    onChange(next.value);
    const group = event.currentTarget.closest('fieldset')!;
    const radios = Array.from(
      group.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
    ).filter((radio) => !radio.disabled);
    radios[nextIndex]!.focus();
  };
  return (
    <fieldset
      id={field.id}
      disabled={disabled}
      className={styles.group}
      role="radiogroup"
      aria-labelledby={`${field.id}-label`}
      aria-describedby={field['aria-describedby']}
      aria-invalid={field['aria-invalid']}
    >
      <legend id={`${field.id}-label`} className={styles.legend}>
        {label}
      </legend>
      <div className={cards ? styles.cards : styles.segments}>
        {options.map((option, index) => (
          <label key={option.value} className={cards ? styles.card : styles.segment}>
            <input
              type="radio"
              name={name ?? field.id}
              value={option.value}
              checked={value === option.value}
              disabled={option.disabled}
              required={required}
              tabIndex={option.value === tabValue ? 0 : -1}
              aria-label={option.label}
              aria-describedby={
                cards && option.description
                  ? `${field.id}-${index}-description`
                  : undefined
              }
              className={styles.radio}
              onChange={() => onChange(option.value)}
              onKeyDown={(event) => navigate(event, option.value)}
            />
            <span className={styles.choiceContent}>
              {option.icon ? <Icon name={option.icon} size={20} /> : null}
              <span className={styles.choiceLabel}>{option.label}</span>
              {cards && option.description ? (
                <span id={`${field.id}-${index}-description`} className={styles.hint}>
                  {option.description}
                </span>
              ) : null}
              {cards ? (
                <Icon name="check" size={14} className={styles.selectedMark} />
              ) : null}
            </span>
          </label>
        ))}
      </div>
      <FieldMessages
        hint={hint}
        error={error}
        hintId={field.hintId}
        errorId={field.errorId}
      />
    </fieldset>
  );
}

export function SegmentedControl<T extends string>(
  props: ChoiceGroupProps<T>,
): ReactElement {
  return <ChoiceGroup {...props} cards={false} />;
}
export function ChoiceCards<T extends string>(props: ChoiceGroupProps<T>): ReactElement {
  return <ChoiceGroup {...props} cards />;
}
