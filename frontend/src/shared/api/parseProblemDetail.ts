import {
  isKnownApiErrorCode,
  type AnyApiErrorCode,
  type ApiFieldError,
  type ApiProblemDetail,
} from './apiError';

/** Status text used when the server sent no usable title. */
const FALLBACK_TITLE = 'Request failed';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function decodeCode(raw: unknown): { code: AnyApiErrorCode; rawCode: string } {
  const rawCode = asString(raw) ?? '';
  if (isKnownApiErrorCode(rawCode)) {
    return { code: rawCode, rawCode };
  }
  return { code: 'UNKNOWN', rawCode };
}

function decodeFieldErrors(raw: unknown): readonly ApiFieldError[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }

  const errors: ApiFieldError[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) {
      continue;
    }
    const field = asString(entry['field']);
    const message = asString(entry['message']);
    if (field !== undefined && message !== undefined) {
      errors.push({ field, message });
    }
  }

  return errors.length > 0 ? errors : undefined;
}

/** A revision is a positive integer. Anything else is ignored rather than trusted. */
function decodeRevision(raw: unknown): number | undefined {
  return typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 1
    ? raw
    : undefined;
}

/**
 * Decodes a parsed JSON value into an {@link ApiProblemDetail}.
 *
 * Returns `null` when the value is not shaped like a ProblemDetail, so the caller can fall back
 * to {@link synthesizeProblemDetail}. Decoding is deliberately lenient about missing optional
 * fields but requires an object that carries at least a `code`, `title`, or numeric `status`.
 *
 * @param value Already-parsed JSON (not a raw string).
 * @param httpStatus Status of the response, used when the body omits `status`.
 */
export function decodeProblemDetail(
  value: unknown,
  httpStatus: number,
): ApiProblemDetail | null {
  if (!isRecord(value)) {
    return null;
  }

  const hasCode = asString(value['code']) !== undefined;
  const hasTitle = asString(value['title']) !== undefined;
  const hasStatus = typeof value['status'] === 'number';

  if (!hasCode && !hasTitle && !hasStatus) {
    return null;
  }

  const { code, rawCode } = decodeCode(value['code']);
  const status = typeof value['status'] === 'number' ? value['status'] : httpStatus;
  const errors = decodeFieldErrors(value['errors']);
  const currentRevision = decodeRevision(value['currentRevision']);
  const retry = decodeRevision(value['retryAfterSeconds']);
  const retryAfterSeconds =
    code === 'RATE_LIMIT_EXCEEDED' && retry !== undefined && retry <= 86400
      ? retry
      : undefined;
  const category = value['quotaCategory'];
  const quotaCategory =
    category === 'LLM' || category === 'ANALYSIS' || category === 'RETRIEVAL'
      ? category
      : undefined;

  return {
    type: asString(value['type']) ?? 'about:blank',
    title: asString(value['title']) ?? FALLBACK_TITLE,
    status,
    detail: asString(value['detail']) ?? asString(value['title']) ?? FALLBACK_TITLE,
    code,
    rawCode,
    ...(errors === undefined ? {} : { errors }),
    ...(currentRevision === undefined ? {} : { currentRevision }),
    ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
    ...(quotaCategory === undefined ? {} : { quotaCategory }),
  };
}

/**
 * Builds a ProblemDetail for a failed response whose body was absent, not JSON, or not shaped
 * like a ProblemDetail — for example an HTML error page from a reverse proxy.
 */
export function synthesizeProblemDetail(
  httpStatus: number,
  statusText: string,
): ApiProblemDetail {
  const title = statusText.length > 0 ? statusText : FALLBACK_TITLE;
  return {
    type: 'about:blank',
    title,
    status: httpStatus,
    detail: `The server returned HTTP ${String(httpStatus)} without a problem description`,
    code: 'UNKNOWN',
    rawCode: '',
  };
}
