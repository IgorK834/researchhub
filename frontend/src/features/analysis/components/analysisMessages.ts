import { t as uiText } from '../../../shared/i18n';
/** Stable failure codes select user-facing guidance. Never derive it from Python stderr or tracebacks. */
const guidance: Readonly<Record<string, string>> = {
  get SANDBOX_DISABLED() {
    return uiText('ui.analysisMessages.message002');
  },
  get SANDBOX_UNAVAILABLE() {
    return uiText('ui.analysisMessages.message003');
  },
  get SANDBOX_INPUT_INVALID() {
    return uiText('ui.analysisMessages.message004');
  },
  get SANDBOX_CLEANUP_FAILED() {
    return uiText('ui.analysisMessages.message005');
  },
  get EXECUTION_TIMEOUT() {
    return uiText('ui.analysisMessages.message006');
  },
  get EXECUTION_RESOURCE_LIMIT() {
    return uiText('ui.analysisMessages.message007');
  },
  get EXECUTION_OUTPUT_LIMIT() {
    return uiText('ui.analysisMessages.message008');
  },
  get EXECUTION_OUTPUT_INVALID() {
    return uiText('ui.analysisMessages.message009');
  },
  get EXECUTION_FAILED() {
    return uiText('ui.analysisMessages.message010');
  },
  get INPUT_UNAVAILABLE() {
    return uiText('ui.analysisMessages.message011');
  },
  get INPUT_CHANGED() {
    return uiText('ui.analysisMessages.message012');
  },
  get ACCESS_REVOKED() {
    return uiText('ui.analysisMessages.message013');
  },
  get EXECUTION_INTERRUPTED() {
    return uiText('ui.analysisMessages.message014');
  },
  get AI_UNAVAILABLE() {
    return uiText('ui.analysisMessages.message015');
  },
  get AI_OUTPUT_INVALID() {
    return uiText('ui.analysisMessages.message016');
  },
  get AI_PROVIDER_ERROR() {
    return uiText('ui.analysisMessages.message017');
  },
};
export function analysisFailureMessage(code: string | null): string {
  return (
    (code && Object.hasOwn(guidance, code) && guidance[code]) ||
    uiText('ui.analysisMessages.message001')
  );
}
