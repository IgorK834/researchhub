/** Public surface of the shared API layer. Import from `shared/api`, not from its modules. */
export { apiClient, request, type ApiRequestOptions, type HttpMethod } from './apiClient';
export { requestEventStream } from './apiClient';
export type { ServerEvent } from './eventStream';
export {
  API_ERROR_CODES,
  ApiError,
  ApiTransportError,
  describeError,
  fieldErrorsByName,
  hasApiErrorCode,
  isApiError,
  isApiTransportError,
  isKnownApiErrorCode,
  type AnyApiErrorCode,
  type ApiErrorCode,
  type ApiFieldError,
  type ApiProblemDetail,
  type UnknownApiErrorCode,
} from './apiError';
export { apiBaseUrl, resolveApiUrl } from './config';
export { apiCredentials } from './credentialsPolicy';
export {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  CSRF_PRIMING_PATH,
  readCsrfToken,
  requiresCsrfToken,
} from './csrf';
export { getHealth, type HealthResponse } from './health';
export { decodeProblemDetail, synthesizeProblemDetail } from './parseProblemDetail';
export { queryKeys } from './queryKeys';
