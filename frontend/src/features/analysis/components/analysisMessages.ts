/** Stable failure codes select user-facing guidance. Never derive it from Python stderr or tracebacks. */
const guidance: Readonly<Record<string, string>> = {
  SANDBOX_DISABLED:
    'Computation is not enabled on this server. Ask the workspace administrator to enable the configured sandbox, then try again.',
  SANDBOX_UNAVAILABLE:
    'The recorded or configured sandbox runtime is unavailable. Ask the administrator to restore it, then retry with the original inputs.',
  SANDBOX_INPUT_INVALID:
    'The sandbox could not verify the selected input files. Inspect their saved versions before trying again.',
  SANDBOX_CLEANUP_FAILED:
    'The server could not finish sandbox cleanup. Ask the administrator to check the runtime before another attempt.',
  EXECUTION_TIMEOUT:
    'The computation exceeded its time limit. Review the request and reduce the work or ask the administrator to review the execution limit.',
  EXECUTION_RESOURCE_LIMIT:
    'The computation exceeded its memory or process limit. Try a smaller dataset or a simpler calculation in a new analysis.',
  EXECUTION_OUTPUT_LIMIT:
    'The computation produced too much output. Create a new request for a summarized table or fewer charts.',
  EXECUTION_OUTPUT_INVALID:
    'The computation did not produce a valid saved result. Inspect the read-only code and create a new analysis to revise the request.',
  EXECUTION_FAILED:
    'The calculation stopped before producing a result. Check the selected data for missing or nonnumeric values and inspect the read-only code.',
  INPUT_UNAVAILABLE:
    'An original input file could not be read. Ask the administrator to restore that exact version before trying again.',
  INPUT_CHANGED:
    'The input bytes did not match their recorded version. Inspect the source or ask the administrator to restore its original bytes.',
  ACCESS_REVOKED:
    'Permission to use this workspace or its inputs changed during execution. Check your workspace access before retrying.',
  EXECUTION_INTERRUPTED:
    'The server stopped before this attempt finished. You can explicitly retry with the original inputs.',
  AI_UNAVAILABLE:
    'The planning service is unavailable or its request limit has been reached. Try the saved request later or ask the administrator to check the provider limits.',
  AI_OUTPUT_INVALID:
    'The planner could not produce a valid plan for the selected sheets and columns. Create a new analysis with a clearer request.',
  AI_PROVIDER_ERROR:
    'The planning service could not complete this request. Try again later or create a new analysis.',
};
export function analysisFailureMessage(code: string | null): string {
  return (
    (code && Object.hasOwn(guidance, code) && guidance[code]) ||
    'This attempt could not be completed. Inspect the saved inputs and code, then try again or create a new analysis.'
  );
}
