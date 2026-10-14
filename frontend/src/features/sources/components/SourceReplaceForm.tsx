import { t as uiText, useLocale as useUiLocale } from '../../../shared/i18n';
import { Panel } from '../../../shared/components/content';
import { Button } from '../../../shared/components/Button';
import { useRef, useState, type ReactElement } from 'react';

import { describeError } from '../../../shared/api';
import { checkSourceFile, SOURCE_FILE_ACCEPT } from '../api/sourceTypes';
import { useReplaceSource } from '../api/useSources';

/** Explicit replacement: the UI never suggests that older analyses silently move to these bytes. */
export function SourceReplaceForm({
  workspaceId,
  sourceId,
}: {
  readonly workspaceId: string;
  readonly sourceId: string;
}): ReactElement {
  useUiLocale();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const replace = useReplaceSource(workspaceId, sourceId);
  return (
    <Panel title={uiText('ui.SourceReplaceForm.message001')}>
      <p>{uiText('ui.SourceReplaceForm.message002')}</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (file === null) {
            setError(uiText('ui.SourceReplaceForm.message008'));
            return;
          }
          replace.mutate(
            { file },
            {
              onSuccess: () => {
                setFile(null);
                setError(null);
                if (input.current) input.current.value = '';
              },
            },
          );
        }}
      >
        {error === null ? null : <p role="alert">{error}</p>}
        {replace.error === null ? null : (
          <p role="alert">
            {uiText('ui.SourceReplaceForm.message003')} {describeError(replace.error)}
          </p>
        )}
        {replace.isSuccess ? (
          <p role="status">
            {uiText('ui.AnalysisStudio.message004')} {replace.data.activeVersionNumber}{' '}
            {uiText('ui.SourceReplaceForm.message004')}
          </p>
        ) : null}
        <label htmlFor="replacement-file">
          {uiText('ui.SourceReplaceForm.message005')}
        </label>{' '}
        <input
          ref={input}
          id="replacement-file"
          type="file"
          accept={SOURCE_FILE_ACCEPT}
          disabled={replace.isPending}
          onChange={(event) => {
            const selected = event.target.files?.[0] ?? null;
            if (selected === null) {
              setFile(null);
              setError(null);
              return;
            }
            const check = checkSourceFile(selected);
            if (!check.ok) {
              setFile(null);
              setError(check.message);
            } else {
              setFile(selected);
              setError(null);
            }
          }}
        />
        <Button type="submit" disabled={replace.isPending}>
          {replace.isPending
            ? uiText('ui.SourceReplaceForm.message006')
            : uiText('ui.SourceReplaceForm.message007')}
        </Button>
      </form>
    </Panel>
  );
}
