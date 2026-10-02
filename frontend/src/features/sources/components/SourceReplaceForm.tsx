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
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const replace = useReplaceSource(workspaceId, sourceId);
  return (
    <Panel title="Upload a new version">
      <p>Existing analyses keep their original version and bytes.</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (file === null) {
            setError('Choose a replacement file');
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
            Could not upload the new version: {describeError(replace.error)}
          </p>
        )}
        {replace.isSuccess ? (
          <p role="status">Version {replace.data.activeVersionNumber} was uploaded.</p>
        ) : null}
        <label htmlFor="replacement-file">Replacement file</label>{' '}
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
          {replace.isPending ? 'Uploading version…' : 'Upload new version'}
        </Button>
      </form>
    </Panel>
  );
}
