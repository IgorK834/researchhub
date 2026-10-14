import { t as uiText, useLocale as useUiLocale } from '../../../shared/i18n';
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
  /** Optional selection cap for bounded workflows such as source comparison. */
  readonly maxSelected?: number;
}

/** Shared controlled selection. Only READY is selectable; no implicit fallback from [] to all. */
export function SourcePicker({
  sources,
  value,
  onChange,
  disabled = false,
  legend = uiText('ui.SourcePicker.message009'),
  action,
  maxSelected,
}: SourcePickerProps): ReactElement {
  useUiLocale();
  const id = useId();
  const ready = sources.filter((source) => source.status === 'READY');
  return (
    <fieldset className={styles.picker} disabled={disabled}>
      <legend>{legend}</legend>
      <ScopeChip selectedSourceIds={value} sourceCount={sources.length} action={action} />
      <ul className={styles.sources}>
        {sources.map((source, index) => {
          const selectable = source.status === 'READY';
          const checked = selectable && (value === null || value.includes(source.id));
          const capped =
            value !== null &&
            maxSelected !== undefined &&
            value.length >= maxSelected &&
            !checked;
          const explanation = `${id}-${String(index)}`;
          return (
            <li key={source.id} data-unavailable={!selectable || undefined}>
              <label>
                <span className={formStyles.checkChrome}>
                  <input
                    className={formStyles.checkbox}
                    type="checkbox"
                    aria-label={source.title}
                    aria-describedby={!selectable ? explanation : undefined}
                    checked={checked}
                    disabled={!selectable || value === null || capped}
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
                <span aria-hidden="true">
                  {source.sourceType ?? uiText('ui.AiDraftBlock.message007')}
                </span>
              </label>
              <SourceStatusChip status={source.status} />
              {!selectable ? (
                <p id={explanation}>
                  {source.status === 'PROCESSING' || source.status === 'UPLOADED'
                    ? uiText('ui.SourcePicker.message001')
                    : uiText('ui.SourcePicker.message002')}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
      {ready.length === 0 ? <p>{uiText('ui.SourcePicker.message003')}</p> : null}
      {maxSelected !== undefined ? (
        <p>
          {uiText('ui.SourcePicker.message004')} {maxSelected}{' '}
          {uiText('ui.SourcePicker.message005')}
        </p>
      ) : null}
      {value !== null && value.length === 0 ? (
        <p>{uiText('ui.SourcePicker.message006')}</p>
      ) : null}
      <div className={styles.actions}>
        <Button
          variant="ghost"
          size="compact"
          onClick={() =>
            onChange(
              ready.map((source) => source.id).slice(0, maxSelected ?? ready.length),
            )
          }
        >
          {uiText('ui.SourcePicker.message007')}
        </Button>
        <Button variant="ghost" size="compact" onClick={() => onChange([])}>
          {uiText('ui.SourcePicker.message008')}
        </Button>
      </div>
    </fieldset>
  );
}
