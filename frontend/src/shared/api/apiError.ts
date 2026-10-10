/**
 * Frontend representation of the backend REST error contract.
 * Field names and codes mirror docs/development/api-errors.md (RFC 9457 ProblemDetail plus a
 * stable `code`). Branch on `code`, never on HTTP status alone and never on a Java class name.
 */

/** Stable machine codes the backend may return. Mirrors `dev.researchhub.shared.error.ApiErrorCode`. */
export const API_ERROR_CODES = [
  'VALIDATION_FAILED',
  'MALFORMED_REQUEST',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'RESOURCE_NOT_FOUND',
  'CONFLICT',
  'COLLABORATION_STATE_REPLACED',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_FILE_TYPE',
  'UNSUPPORTED_MEDIA_TYPE',
  'AI_UNAVAILABLE',
  'EXTERNAL_SEARCH_UNAVAILABLE',
  'EXTERNAL_SEARCH_FAILED',
  'AI_PROVIDER_ERROR',
  'AI_OUTPUT_INVALID',
  'AI_REFUSED',
  'AI_CONTEXT_TOO_LARGE',
  'RATE_LIMIT_EXCEEDED',
  'INTERNAL_ERROR',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/**
 * A code the frontend does not recognise. Kept as a distinct member of the union so a newer
 * backend adding a code does not turn into a crash or a silent mismatch.
 */
export type UnknownApiErrorCode = 'UNKNOWN';

export type AnyApiErrorCode = ApiErrorCode | UnknownApiErrorCode;

export function isKnownApiErrorCode(value: string): value is ApiErrorCode {
  return (API_ERROR_CODES as readonly string[]).includes(value);
}

/** One field-level validation failure. Present only when `code` is `VALIDATION_FAILED`. */
export interface ApiFieldError {
  readonly field: string;
  readonly message: string;
}

/** Decoded `application/problem+json` body. */
export interface ApiProblemDetail {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string;
  readonly code: AnyApiErrorCode;
  /** Raw `code` as sent by the server, useful when `code` decoded to `UNKNOWN`. */
  readonly rawCode: string;
  readonly errors?: readonly ApiFieldError[];
  /**
   * The stored revision, on a `CONFLICT` caused by saving a stale revision of a document. Absent on every other
   * error, including the other conflicts — an archived document is not a newer revision to reload. Optional
   * even there: a caller must still handle a `CONFLICT` without it, and fall back to `detail`.
   */
  readonly currentRevision?: number;
  /** Bounded delay for RATE_LIMIT_EXCEEDED; retries always require an explicit user action. */
  readonly retryAfterSeconds?: number;
  readonly quotaCategory?: 'LLM' | 'ANALYSIS' | 'RETRIEVAL';
  readonly reason?: 'TARGET_STALE' | 'NOT_SYNCHRONIZED';
}

/**
 * The server answered with a non-2xx status.
 *
 * `problem` always exists: when the body was missing or not a ProblemDetail it is synthesised
 * from the HTTP status so call sites have one shape to read.
 */
export class ApiError extends Error {
  override readonly name = 'ApiError';
  readonly problem: ApiProblemDetail;
  readonly status: number;
  readonly code: AnyApiErrorCode;

  constructor(problem: ApiProblemDetail) {
    super(problem.detail || problem.title);
    this.problem = problem;
    this.status = problem.status;
    this.code = problem.code;
  }

  /** Field errors for a `VALIDATION_FAILED` response, empty for every other code. */
  get fieldErrors(): readonly ApiFieldError[] {
    return this.problem.errors ?? [];
  }
}

/**
 * The request never produced a usable HTTP response: DNS/connection failure, the backend is
 * not running, CORS blocked it, or the response body could not be decoded.
 *
 * Deliberately distinct from {@link ApiError} — there is no `code` to branch on and retrying
 * may be reasonable, whereas a `FORBIDDEN` will not fix itself.
 */
export class ApiTransportError extends Error {
  override readonly name = 'ApiTransportError';

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function isApiTransportError(error: unknown): error is ApiTransportError {
  return error instanceof ApiTransportError;
}

/** True when `error` is an {@link ApiError} carrying the given stable code. */
export function hasApiErrorCode(error: unknown, code: AnyApiErrorCode): boolean {
  return isApiError(error) && error.code === code;
}

/**
 * Field errors from a `VALIDATION_FAILED` response, keyed by field name, for rendering next to the
 * matching form input. Empty for any other error.
 *
 * When a field has more than one violation only the first is kept: a form shows one message per input,
 * and fixing the first often resolves the rest.
 */
export function fieldErrorsByName(error: unknown): Readonly<Record<string, string>> {
  if (!isApiError(error)) {
    return {};
  }

  const byName: Record<string, string> = {};
  for (const fieldError of error.fieldErrors) {
    if (!(fieldError.field in byName)) {
      byName[fieldError.field] = fieldError.message;
    }
  }
  return byName;
}

/** Message safe to render in the UI for any error this layer can produce. */
export function describeError(error: unknown): string {
  if (isApiError(error)) {
    if (error.code === 'AI_OUTPUT_INVALID') {
      return 'The AI response could not be validated. Please try again or rephrase your request.';
    }
    if (error.code === 'AI_UNAVAILABLE') {
      return 'The AI service is unavailable or its request limit has been reached. Try again later or ask the administrator to check the provider limits.';
    }
    const message = error.problem.detail || error.problem.title;
    if (
      error.code === 'RATE_LIMIT_EXCEEDED' &&
      error.problem.retryAfterSeconds !== undefined
    ) {
      return `${message} Try again in ${String(error.problem.retryAfterSeconds)} seconds.`;
    }
    return message;
  }

  if (isApiTransportError(error)) {
    return error.message;
  }

  return 'An unexpected error occurred';
}
