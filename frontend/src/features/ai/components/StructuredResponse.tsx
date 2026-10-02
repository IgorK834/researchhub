import type { ReactElement } from 'react';
import type { GeneratedResponse } from '../api/generationApi';
import { GroundedAnswer } from './GroundedAnswer';

/** Reusable structured-result renderer for feature callers of the model gateway. */
export function StructuredResponse({
  response,
}: {
  readonly response: GeneratedResponse;
}): ReactElement {
  return (
    <GroundedAnswer
      fullLocation={false}
      status={response.result.answer.status}
      generation={response}
      evidence={
        response.result.answer.status === 'INSUFFICIENT_EVIDENCE'
          ? []
          : response.evidence.map((citation) => ({
              citation,
              label:
                response.context?.citations.find(
                  (binding) => binding.chunkId === citation.chunkId,
                )?.citationKey ?? '',
            }))
      }
    />
  );
}
