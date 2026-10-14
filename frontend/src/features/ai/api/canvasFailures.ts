import { t as uiText } from '../../../shared/i18n';
import { ApiError, type ApiErrorCode } from '../../../shared/api';

export function canvasFailure(code: ApiErrorCode | null | undefined): string {
  switch (code) {
    case 'AI_OUTPUT_INVALID':
      return uiText('ui.canvasFailures.message001');
    case 'RATE_LIMIT_EXCEEDED':
      return uiText('ui.canvasFailures.message002');
    case 'FORBIDDEN':
    case 'RESOURCE_NOT_FOUND':
    case 'UNAUTHENTICATED':
      return uiText('ui.canvasFailures.message003');
    case 'AI_UNAVAILABLE':
      return uiText('ui.canvasFailures.message004');
    case 'AI_REFUSED':
      return uiText('ui.canvasFailures.message005');
    case 'CONFLICT':
      return uiText('ui.canvasFailures.message006');
    default:
      return uiText('ui.canvasFailures.message007');
  }
}
export function describeCanvasFailure(error: unknown): string {
  return canvasFailure(
    error instanceof ApiError
      ? error.problem.code === 'UNKNOWN'
        ? null
        : error.problem.code
      : null,
  );
}
/** Bounded polling, independent of provider retry. Terminal/error state stops observation. */
export function canvasPollDelay(
  pending: boolean,
  updates: number,
  failed: boolean,
): number | false {
  return pending && !failed
    ? Math.min(16000, 2000 * 2 ** Math.min(3, Math.floor(Math.max(0, updates - 1) / 3)))
    : false;
}
