/** Public surface of the shared API layer. Import from `shared/api`, not from its modules. */
export { apiClient, request, type ApiRequestOptions, type HttpMethod } from './apiClient';
export {
  API_ERROR_CODES,
  ApiError,
  ApiTransportError,
  describeError,
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
export { getHealth, type HealthResponse } from './health';
export { decodeProblemDetail, synthesizeProblemDetail } from './parseProblemDetail';
export { queryKeys } from './queryKeys';
