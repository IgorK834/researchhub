import styles from './SourceDetail.module.css';
import { TextField } from '../../../shared/components/forms';
import { Panel } from '../../../shared/components/content';
import { Button } from '../../../shared/components/Button';
import { useState, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../../shared/api';
import { fetchSourceExtraction } from '../api/sourceExtraction';
import { parsePdfPage, pdfPreviewPath } from '../api/sourceLocations';

export function PdfSourcePreview({
  workspaceId,
  sourceId,
  revision,
  ready,
  requestedPage,
  onNavigate,
}: {
  readonly workspaceId: string;
  readonly sourceId: string;
  readonly revision?: string;
  readonly ready: boolean;
  readonly requestedPage: string | null;
  readonly onNavigate: (page: number) => void;
}): ReactElement {
  const { data } = useQuery({
    queryKey: queryKeys.sourceExtraction(workspaceId, sourceId, revision),
    queryFn: ({ signal }) => fetchSourceExtraction(workspaceId, sourceId, signal),
    enabled: ready,
  });
  const count = data?.extractionMetadata?.pageCount;
  const parsed = parsePdfPage(requestedPage, count);
  const page = parsed ?? 1;
  return (
    <Panel title="PDF preview">
      {parsed === null ? (
        <p role="alert">
          The requested PDF page is not available. Enter a valid page number.
        </p>
      ) : null}
      <p>
        Page {page}
        {count && count > 0 ? ` of ${String(count)}` : ''}
      </p>
      <PdfPageForm key={page} page={page} count={count} onNavigate={onNavigate} />
      <div className={styles.actions}>
        <Button
          variant="secondary"
          type="button"
          disabled={page <= 1}
          onClick={() => onNavigate(page - 1)}
        >
          Previous PDF page
        </Button>
        <Button
          variant="secondary"
          type="button"
          disabled={page >= (count && count > 0 ? count : 10000)}
          onClick={() => onNavigate(page + 1)}
        >
          Next PDF page
        </Button>
        <p>
          <a
            href={pdfPreviewPath(workspaceId, sourceId, page)}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open PDF at page {page}
          </a>
        </p>
      </div>
      <p>
        The PDF opens in your browser viewer. Page navigation depends on browser support.
      </p>
    </Panel>
  );
}

function PdfPageForm({
  page,
  count,
  onNavigate,
}: {
  readonly page: number;
  readonly count: number | undefined;
  readonly onNavigate: (page: number) => void;
}): ReactElement {
  const [input, setInput] = useState(String(page));
  const [invalidInput, setInvalidInput] = useState(false);
  return (
    <>
      {invalidInput ? (
        <p role="alert">
          The requested PDF page is not available. Enter a valid page number.
        </p>
      ) : null}
      <form
        className={styles.actions}
        onSubmit={(event) => {
          event.preventDefault();
          const selected = parsePdfPage(input, count);
          if (selected === null) {
            setInvalidInput(true);
            return;
          }
          setInvalidInput(false);
          onNavigate(selected);
        }}
      >
        <TextField
          label="PDF page"
          type="number"
          min={1}
          max={count && count > 0 ? count : 10000}
          value={input}
          onChange={(event) => setInput(event.target.value)}
        />
        <Button variant="secondary" type="submit">
          Go to page
        </Button>
      </form>
    </>
  );
}
