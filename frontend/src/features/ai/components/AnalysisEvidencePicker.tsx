import { t as uiText, useLocale as useUiLocale } from '../../../shared/i18n';
import { useState, type ReactElement } from 'react';
import { AnalysisOutputPicker } from '../../analysis/components/AnalysisOutputPicker';
import type { AnalysisEvidenceReference } from '../api/generationApi';
import { Button } from '../../../shared/components/Button';

export function AnalysisEvidencePicker({
  workspaceId,
  value,
  onChange,
  disabled,
}: {
  readonly workspaceId: string;
  readonly value: readonly AnalysisEvidenceReference[];
  readonly onChange: (value: readonly AnalysisEvidenceReference[]) => void;
  readonly disabled: boolean;
}): ReactElement {
  useUiLocale();
  const [open, setOpen] = useState(false);
  return (
    <section aria-label={uiText('ui.AnalysisEvidencePicker.message001')}>
      <h3>{uiText('ui.AnalysisEvidencePicker.message002')}</h3>
      <p>{uiText('ui.AnalysisEvidencePicker.message003')}</p>
      {value.length ? (
        <ul>
          {value.map((ref) => (
            <li key={`${ref.analysisId}:${ref.executionId}:${ref.outputId}`}>
              {uiText('ui.AnalysisEvidencePicker.message004')}{' '}
              {ref.executionId.slice(0, 8)} · {ref.outputId}{' '}
              <Button
                variant="ghost"
                disabled={disabled}
                onClick={() => onChange(value.filter((item) => item !== ref))}
              >
                {uiText('ui.AnalysisEvidencePicker.message005')} {ref.outputId}
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p>{uiText('ui.AnalysisEvidencePicker.message006')}</p>
      )}
      <Button
        variant="secondary"
        disabled={disabled || value.length >= 6}
        onClick={() => setOpen(!open)}
      >
        {open
          ? uiText('ui.AnalysisEvidencePicker.message007')
          : uiText('ui.AnalysisEvidencePicker.message008')}
      </Button>
      {open ? (
        <AnalysisOutputPicker
          workspaceId={workspaceId}
          disabled={disabled}
          onChoose={(ref) => {
            const { analysisId, executionId, outputId } = ref;
            if (
              !value.some(
                (item) =>
                  item.analysisId === analysisId &&
                  item.executionId === executionId &&
                  item.outputId === outputId,
              )
            )
              onChange([...value, { analysisId, executionId, outputId }]);
            setOpen(false);
          }}
        />
      ) : null}
    </section>
  );
}
