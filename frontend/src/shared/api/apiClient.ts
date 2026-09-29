import { ApiError, ApiTransportError } from './apiError';
import { resolveApiUrl } from './config';
import { apiCredentials } from './credentialsPolicy';
import { CSRF_HEADER_NAME, readCsrfToken, requiresCsrfToken } from './csrf';
import { decodeProblemDetail, synthesizeProblemDetail } from './parseProblemDetail';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ApiRequestOptions {
  /** Serialised as JSON. Omit for requests without a body. */
  readonly body?: unknown;
  /** Sent as multipart data. The browser supplies the Content-Type boundary. */
  readonly formData?: FormData;
  /** Propagated to `fetch`, so TanStack Query can cancel in-flight requests. */
  readonly signal?: AbortSignal;
  readonly headers?: Readonly<Record<string, string>>;
  /** Uses XMLHttpRequest for multipart requests, where the browser exposes upload byte progress. */
  readonly onUploadProgress?: (loaded: number, total: number) => void;
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
function problemFromBody(
  rawBody: string,
  status: number,
  statusText: string,
  contentType: string | null,
): ApiError {
  if (rawBody.length > 0 && isJsonContentType(contentType)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return new ApiError(synthesizeProblemDetail(status, statusText));
    }

    const problem = decodeProblemDetail(parsed, status);
    if (problem !== null) {
      return new ApiError(problem);
    }
  }

  return new ApiError(synthesizeProblemDetail(status, statusText));
}

async function toApiError(response: Response): Promise<ApiError> {
  return problemFromBody(
    await readBodyText(response),
    response.status,
    response.statusText,
    response.headers.get('content-type'),
  );
}

function multipartWithProgress<TResponse>(
  path: string,
  formData: FormData,
  headers: Readonly<Record<string, string>>,
  onUploadProgress: (loaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<TResponse> {
  if (signal?.aborted) {
    return Promise.reject(new DOMException('Aborted', 'AbortError'));
  }
  return new Promise<TResponse>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const abort = (): void => xhr.abort();
    signal?.addEventListener('abort', abort, { once: true });
    xhr.onloadend = () => signal?.removeEventListener('abort', abort);
    xhr.open('POST', resolveApiUrl(path));
    xhr.withCredentials = apiCredentials === 'include';
    for (const [name, value] of Object.entries(headers)) {
      xhr.setRequestHeader(name, value);
    }
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onUploadProgress(event.loaded, event.total);
      }
    };
    xhr.onerror = () =>
      reject(
        new ApiTransportError(
          'Could not reach the ResearchHub API. Check that the backend is running.',
        ),
      );
    xhr.onabort = () => reject(new DOMException('Aborted', 'AbortError'));
    xhr.onload = () => {
      const contentType = xhr.getResponseHeader('content-type');
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(
          problemFromBody(xhr.responseText, xhr.status, xhr.statusText, contentType),
        );
        return;
      }
      if (xhr.status === 204 || xhr.status === 205 || xhr.responseText.length === 0) {
        resolve(undefined as TResponse);
        return;
      }
      try {
        resolve(JSON.parse(xhr.responseText) as TResponse);
      } catch (cause) {
        reject(
          new ApiTransportError('The server returned a malformed JSON response', {
            cause,
          }),
        );
      }
    };
    xhr.send(formData);
  });
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
  const { body, formData, signal, headers, onUploadProgress } = options;

  if (body !== undefined && formData !== undefined) {
    throw new TypeError('An API request cannot have both a JSON body and form data');
  }
  if (onUploadProgress !== undefined && (formData === undefined || method !== 'POST')) {
    throw new TypeError('Upload progress is supported only for multipart POST requests');
  }

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

  if (formData !== undefined && onUploadProgress !== undefined) {
    return multipartWithProgress<TResponse>(
      path,
      formData,
      requestHeaders,
      onUploadProgress,
      signal,
    );
  }

  let response: Response;
  try {
    response = await fetch(resolveApiUrl(path), {
      method,
      credentials: apiCredentials,
      headers: requestHeaders,
      ...(body === undefined && formData === undefined
        ? {}
        : { body: formData ?? JSON.stringify(body) }),
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
