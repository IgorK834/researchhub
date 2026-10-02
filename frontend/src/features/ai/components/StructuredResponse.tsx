import type { ReactElement } from 'react';
import { citationPath, type GeneratedResponse } from '../api/generationApi';

/** Reusable structured-result renderer for feature callers of the model gateway. */
export function StructuredResponse({
  response,
}: {
  readonly response: GeneratedResponse;
}): ReactElement {
  const { result, evidence } = response;
  return (
    <section aria-label="Source-grounded response">
      {result.answer.status === 'INSUFFICIENT_EVIDENCE' ? (
        <p>There is insufficient evidence to answer this request.</p>
      ) : (
        <ol>
          {result.answer.claims.map((claim, index) => (
            <li key={index}>
              <p>{claim.text}</p>
              <ul aria-label="Supporting sources">
                {claim.evidenceIds.map((id) => {
                  const citation = evidence.find((item) => item.chunkId === id);
                  const binding = response.context?.citations.find(
                    (item) => item.chunkId === id,
                  );
                  return citation === undefined ? (
                    <li key={id} role="alert">
                      Source reference is unavailable.
                    </li>
                  ) : (
                    <li key={id}>
                      <a
                        href={citationPath(citation)}
                        style={{
                          display: 'inline-block',
                          border: '1px solid var(--color-border)',
                          borderRadius: '1rem',
                          padding: '0.2rem 0.55rem',
                        }}
                      >
                        {binding === undefined ? '' : `[${binding.citationKey}] `}
                        {citation.title ?? citation.sectionTitle ?? 'Source'}
                        {citation.pageStart === null
                          ? ''
                          : ` · Page ${String(citation.pageStart)}`}
                      </a>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ol>
      )}
      <p>
        Model: {result.model.name} ({result.model.version}) · {result.model.provider}
      </p>
      <p>
        {result.usage.estimated ? 'Estimated tokens' : 'Tokens'}:{' '}
        {result.usage.totalTokens}
        {' · '}Input: {result.usage.inputTokens}
        {' · '}Output: {result.usage.outputTokens}
      </p>
    </section>
  );
}
