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
  const [open, setOpen] = useState(false);
  return (
    <section aria-label="Computed evidence scope">
      <h3>Computed evidence</h3>
      <p>
        Choose saved successful outputs to compare with sources. Asking a question does
        not run a calculation.
      </p>
      {value.length ? (
        <ul>
          {value.map((ref) => (
            <li key={`${ref.analysisId}:${ref.executionId}:${ref.outputId}`}>
              Execution {ref.executionId.slice(0, 8)} · {ref.outputId}{' '}
              <Button
                variant="ghost"
                disabled={disabled}
                onClick={() => onChange(value.filter((item) => item !== ref))}
              >
                Remove output {ref.outputId}
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p>No computed outputs selected.</p>
      )}
      <Button
        variant="secondary"
        disabled={disabled || value.length >= 6}
        onClick={() => setOpen(!open)}
      >
        {open ? 'Hide saved outputs' : 'Choose computed output'}
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
