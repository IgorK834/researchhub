import { useId, type ReactElement } from 'react';
import { Button } from '../../../shared/components/Button';
import { ScopeChip } from '../../../shared/components/ScopeChip';
import { SourceStatusChip, SourceTypeTile } from '../../sources/components/SourceVisuals';
import styles from './SourcePicker.module.css';
import formStyles from '../../../shared/components/forms/Forms.module.css';
import { Icon } from '../../../shared/components/icons';

export interface PickableSource {
  readonly id: string;
  readonly title: string;
  readonly sourceType?: string;
  readonly status: string;
}
export interface SourcePickerProps {
  readonly sources: readonly PickableSource[];
  readonly value: readonly string[] | null;
  readonly onChange: (ids: readonly string[]) => void;
  readonly disabled?: boolean;
  readonly legend?: string;
  readonly action?: string;
}

/** Shared controlled selection. Only READY is selectable; no implicit fallback from [] to all. */
export function SourcePicker({
  sources,
  value,
  onChange,
  disabled = false,
  legend = 'Source selection',
  action,
}: SourcePickerProps): ReactElement {
  const id = useId();
  const ready = sources.filter((source) => source.status === 'READY');
  return (
    <fieldset className={styles.picker} disabled={disabled}>
      <legend>{legend}</legend>
      <ScopeChip selectedSourceIds={value} readyCount={ready.length} action={action} />
      <ul className={styles.sources}>
        {sources.map((source, index) => {
          const selectable = source.status === 'READY';
          const explanation = `${id}-${String(index)}`;
          return (
            <li key={source.id} data-unavailable={!selectable || undefined}>
              <label>
                <span className={formStyles.checkChrome}>
                <input className={formStyles.checkbox}
                  type="checkbox"
                  aria-label={source.title}
                  aria-describedby={!selectable ? explanation : undefined}
                  checked={selectable && (value === null || value.includes(source.id))}
                  disabled={!selectable || value === null}
                  onChange={(event) => {
                    const selected = value ?? [];
                    onChange(
                      event.target.checked
                        ? [...selected.filter((item) => item !== source.id), source.id]
                        : selected.filter((item) => item !== source.id),
                    );
                  }}
                />
                <Icon name="check" size={14} className={formStyles.checkmark} />
                </span>
                <SourceTypeTile
                  sourceType={source.sourceType ?? 'Source'}
                  size="default"
                />
                <span className={styles.title}>{source.title}</span>
                <span aria-hidden="true">{source.sourceType ?? 'Source'}</span>
              </label>
              <SourceStatusChip status={source.status} />
              {!selectable ? (
                <p id={explanation}>
                  {source.status === 'PROCESSING' || source.status === 'UPLOADED'
                    ? 'This source is still processing. It can be selected when ready.'
                    : 'This source is not ready. It cannot be selected as evidence.'}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
      {ready.length === 0 ? <p>No ready sources available.</p> : null}
      {value !== null && value.length === 0 ? (
        <p>No sources selected. The answer will have no evidence.</p>
      ) : null}
      <div className={styles.actions}>
        <Button
          variant="ghost"
          size="compact"
          onClick={() => onChange(ready.map((source) => source.id))}
        >
          Select all ready
        </Button>
        <Button variant="ghost" size="compact" onClick={() => onChange([])}>
          Clear
        </Button>
      </div>
    </fieldset>
  );
}
