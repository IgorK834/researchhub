import { useRef, useState, type ReactElement } from 'react';

import { describeError } from '../../../shared/api';
import {
  checkSourceFile,
  SOURCE_FILE_ACCEPT,
  supportedTypesSentence,
} from '../api/sourceTypes';
import { useUploadSource } from '../api/useSources';

/** File picker for owners/editors. The backend repeats every validation and authorization check. */
export function SourceUploadForm({
  workspaceId,
}: {
  readonly workspaceId: string;
}): ReactElement {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);
  const [uploadedName, setUploadedName] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const upload = useUploadSource(workspaceId);

  const choose = (chosen: File | null): void => {
    setUploadedName(null);
    setProgress(null);
    upload.reset();
    if (chosen === null) {
      setFile(null);
      setClientError(null);
      return;
    }
    const check = checkSourceFile(chosen);
    if (!check.ok) {
      setFile(null);
      setClientError(check.message);
      return;
    }
    setFile(chosen);
    setClientError(null);
  };

  return (
    <section aria-labelledby="upload-source-heading">
      <h2 id="upload-source-heading">Upload source</h2>
      <p>{supportedTypesSentence()} Maximum size: 50 MB.</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (file === null) {
            if (clientError === null) {
              setClientError('Choose a source file to upload');
            }
            return;
          }
          setProgress(null);
          upload.mutate(
            {
              file,
              onProgress: (loaded, total) => {
                setProgress(Math.min(100, Math.round((loaded / total) * 100)));
              },
            },
            {
              onSuccess: (created) => {
                setUploadedName(created.displayName);
                setFile(null);
                setClientError(null);
                if (input.current !== null) {
                  input.current.value = '';
                }
              },
            },
          );
        }}
      >
        {clientError !== null ? <p role="alert">{clientError}</p> : null}
        {upload.error !== null ? <p role="alert">{describeError(upload.error)}</p> : null}
        {upload.isPending ? (
          <p role="status" aria-live="polite">
            Uploading {file?.name}
            {progress === null ? '…' : `: ${String(progress)}%`}
            <progress
              aria-label="Upload progress"
              value={progress ?? undefined}
              max={100}
            />
          </p>
        ) : null}
        {uploadedName !== null ? (
          <p role="status" aria-live="polite">
            Uploaded {uploadedName}.
          </p>
        ) : null}
        <p>
          <label htmlFor="source-file">Source file</label>
          <input
            ref={input}
            id="source-file"
            name="source-file"
            type="file"
            accept={SOURCE_FILE_ACCEPT}
            disabled={upload.isPending}
            onChange={(event) => choose(event.target.files?.[0] ?? null)}
          />
        </p>
        <button type="submit" disabled={upload.isPending}>
          {upload.isPending ? 'Uploading…' : 'Upload source'}
        </button>
      </form>
    </section>
  );
}
