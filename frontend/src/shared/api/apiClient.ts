import { ApiError, ApiTransportError } from './apiError';
import { resolveApiUrl } from './config';
import { apiCredentials } from './credentialsPolicy';
import { CSRF_HEADER_NAME, readCsrfToken, requiresCsrfToken } from './csrf';
import { decodeProblemDetail, synthesizeProblemDetail } from './parseProblemDetail';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ApiRequestOptions {
  /** Serialised as JSON. Omit for requests without a body. */
  readonly body?: unknown;
  /** Propagated to `fetch`, so TanStack Query can cancel in-flight requests. */
  readonly signal?: AbortSignal;
  readonly headers?: Readonly<Record<string, string>>;
}

function isJsonContentType(contentType: string | null): boolean {
  if (contentType === null) {
    return false;
  }
  return contentType.includes('json');
}

/** `true` when the caller aborted the request, which must propagate untouched. */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

async function readBodyText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch (cause) {
    throw new ApiTransportError('The server response could not be read', { cause });
  }
}

/**
 * Turns a non-2xx response into an {@link ApiError}, decoding the ProblemDetail body when the
 * server sent one and synthesising a stand-in when it did not.
 */
async function toApiError(response: Response): Promise<ApiError> {
  const rawBody = await readBodyText(response);

  if (rawBody.length > 0 && isJsonContentType(response.headers.get('content-type'))) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return new ApiError(synthesizeProblemDetail(response.status, response.statusText));
    }

    const problem = decodeProblemDetail(parsed, response.status);
    if (problem !== null) {
      return new ApiError(problem);
    }
  }

  return new ApiError(synthesizeProblemDetail(response.status, response.statusText));
}

/**
 * Single entry point for HTTP calls. Components, pages, and hooks must not call `fetch`
 * directly — see docs/development/frontend-api.md.
 *
 * @throws {ApiError} The server responded with a non-2xx status.
 * @throws {ApiTransportError} No usable response arrived, or the success body was not valid JSON.
 * @throws {DOMException} `AbortError`, propagated unchanged when `options.signal` aborts.
 */
export async function request<TResponse>(
  method: HttpMethod,
  path: string,
  options: ApiRequestOptions = {},
): Promise<TResponse> {
  const { body, signal, headers } = options;

  const requestHeaders: Record<string, string> = {
    Accept: 'application/json',
    ...headers,
  };
  if (body !== undefined) {
    requestHeaders['Content-Type'] = 'application/json';
  }

  // The session cookie is sent by the browser on its own, so a mutating request must also prove it
  // originated from our page. Done here rather than at each call site so no endpoint can forget.
  if (requiresCsrfToken(method)) {
    const csrfToken = readCsrfToken();
    if (csrfToken !== null) {
      requestHeaders[CSRF_HEADER_NAME] = csrfToken;
    }
  }

  let response: Response;
  try {
    response = await fetch(resolveApiUrl(path), {
      method,
      credentials: apiCredentials,
      headers: requestHeaders,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (cause) {
    if (isAbortError(cause)) {
      throw cause;
    }
    throw new ApiTransportError(
      'Could not reach the ResearchHub API. Check that the backend is running.',
      { cause },
    );
  }

  if (!response.ok) {
    throw await toApiError(response);
  }

  if (response.status === 204 || response.status === 205) {
    return undefined as TResponse;
  }

  const rawBody = await readBodyText(response);
  if (rawBody.length === 0) {
    return undefined as TResponse;
  }

  try {
    return JSON.parse(rawBody) as TResponse;
  } catch (cause) {
    throw new ApiTransportError('The server returned a malformed JSON response', {
      cause,
    });
  }
}

export const apiClient = {
  get: <TResponse>(path: string, options?: ApiRequestOptions): Promise<TResponse> =>
    request<TResponse>('GET', path, options),
  post: <TResponse>(path: string, options?: ApiRequestOptions): Promise<TResponse> =>
    request<TResponse>('POST', path, options),
  put: <TResponse>(path: string, options?: ApiRequestOptions): Promise<TResponse> =>
    request<TResponse>('PUT', path, options),
  patch: <TResponse>(path: string, options?: ApiRequestOptions): Promise<TResponse> =>
    request<TResponse>('PATCH', path, options),
  delete: <TResponse>(path: string, options?: ApiRequestOptions): Promise<TResponse> =>
    request<TResponse>('DELETE', path, options),
} as const;
