/** @jest-environment jsdom */
import { apiClient } from './apiClient';
import { ApiError } from './apiError';

class UploadRequest {
  static last: UploadRequest;
  readonly upload: { onprogress: ((event: ProgressEvent) => void) | null } = {
    onprogress: null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  withCredentials = false;
  status = 201;
  statusText = '';
  responseText = '{"id":"s-1"}';
  path = '';
  body: FormData | null = null;
  readonly headers: Record<string, string> = {};

  constructor() {
    UploadRequest.last = this;
  }

  open(method: string, path: string): void {
    expect(method).toBe('POST');
    this.path = path;
  }

  setRequestHeader(name: string, value: string): void {
    this.headers[name] = value;
  }

  getResponseHeader(): string {
    return this.status >= 400 ? 'application/problem+json' : 'application/json';
  }

  send(body: FormData): void {
    this.body = body;
  }

  complete(): void {
    this.onload?.();
  }
}

const originalXhr = globalThis.XMLHttpRequest;

beforeEach(() => {
  globalThis.XMLHttpRequest = UploadRequest as unknown as typeof XMLHttpRequest;
  document.cookie = 'XSRF-TOKEN=upload-token';
});

afterEach(() => {
  globalThis.XMLHttpRequest = originalXhr;
  document.cookie = 'XSRF-TOKEN=; Max-Age=0';
});

it('sends multipart data with CSRF and reports computable upload progress', async () => {
  const progress = jest.fn();
  const formData = new FormData();
  formData.append('file', new File(['csv'], 'team.csv', { type: 'text/csv' }));
  const result = apiClient.post<{ id: string }>('/api/workspaces/w-1/sources', {
    formData,
    onUploadProgress: progress,
  });
  const xhr = UploadRequest.last;

  expect(xhr.path).toBe('/api/workspaces/w-1/sources');
  expect(xhr.body).toBe(formData);
  expect(xhr.headers['X-XSRF-TOKEN']).toBe('upload-token');
  expect(xhr.headers['Content-Type']).toBeUndefined();
  expect(xhr.withCredentials).toBe(false);
  xhr.upload.onprogress?.({
    lengthComputable: false,
    loaded: 3,
    total: 10,
  } as ProgressEvent);
  xhr.upload.onprogress?.({
    lengthComputable: true,
    loaded: 3,
    total: 10,
  } as ProgressEvent);
  expect(progress).toHaveBeenCalledTimes(1);
  expect(progress).toHaveBeenCalledWith(3, 10);

  xhr.complete();
  await expect(result).resolves.toEqual({ id: 's-1' });
});

it('decodes a rejected upload using the shared ProblemDetail contract', async () => {
  const result = apiClient.post('/api/workspaces/w-1/sources', {
    formData: new FormData(),
    onUploadProgress: jest.fn(),
  });
  const xhr = UploadRequest.last;
  xhr.status = 415;
  xhr.responseText = JSON.stringify({
    type: 'about:blank',
    title: 'Unsupported file type',
    status: 415,
    detail: 'The file contents do not match its extension',
    code: 'UNSUPPORTED_FILE_TYPE',
  });
  xhr.complete();

  await expect(result).rejects.toMatchObject({
    code: 'UNSUPPORTED_FILE_TYPE',
    message: 'The file contents do not match its extension',
  } satisfies Partial<ApiError>);
});
