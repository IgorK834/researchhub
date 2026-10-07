/// <reference types="node" />

interface Policy {
  readonly headers: Record<string, string>;
  readonly httpsOnlyHeaders: Record<string, string>;
  readonly metaCsp: string;
}
const { browserPolicy } = jest.requireActual<{
  browserPolicy: (env?: Record<string, string>) => Policy;
}>('../../security/browserPolicy.cjs');

it('enforces external scripts and styles, blocks frames and permits required style attributes and chart blobs', () => {
  const policy = browserPolicy();
  const csp = policy.headers['Content-Security-Policy']!;
  for (const directive of [
    "default-src 'none'",
    "script-src 'self'",
    "script-src-attr 'none'",
    "style-src 'self'",
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' blob:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "worker-src 'none'",
  ])
    expect(csp).toContain(directive);
  expect(csp).not.toContain('unsafe-eval');
  expect(policy.metaCsp).not.toContain('frame-ancestors');
  expect(policy.headers['X-Content-Type-Options']).toBe('nosniff');
  expect(policy.headers['X-Frame-Options']).toBe('DENY');
  expect(policy.httpsOnlyHeaders).toEqual({});
  expect(browserPolicy({ RESEARCHHUB_DEPLOYMENT_ENV: 'cloud' }).httpsOnlyHeaders).toEqual(
    {
      'Strict-Transport-Security': 'max-age=31536000',
    },
  );
});

it('permits only explicit API and websocket origins and deduplicates them', () => {
  expect(
    browserPolicy({
      RESEARCHHUB_DEPLOYMENT_ENV: 'cloud',
      RESEARCHHUB_API_BASE_URL: 'https://api.example.com',
      RESEARCHHUB_CSP_CONNECT_ORIGINS: 'wss://collab.example.com,https://api.example.com',
    }).headers['Content-Security-Policy'],
  ).toContain("connect-src 'self' https://api.example.com wss://collab.example.com;");
  expect(
    browserPolicy({
      RESEARCHHUB_CSP_CONNECT_ORIGINS:
        'ws://localhost:8091,http://127.0.0.1:8080,ws://[::1]:8091',
    }).headers['Content-Security-Policy'],
  ).toContain('ws://localhost:8091 http://127.0.0.1:8080 ws://[::1]:8091');
});

it.each([
  '*',
  'https://*.example.com',
  'https://user:secret@example.com',
  'https://example.com/',
  'https://example.com/api',
  'https://example.com?x=1',
  'https://example.com#x',
  'data:text/plain,attack',
  'http://remote.example.com',
  'ws://remote.example.com',
])('rejects unsafe CSP origin %s', (origin) => {
  expect(() => browserPolicy({ RESEARCHHUB_CSP_CONNECT_ORIGINS: origin })).toThrow();
});

it('rejects insecure connections in cloud and unknown deployment environments', () => {
  expect(() =>
    browserPolicy({
      RESEARCHHUB_DEPLOYMENT_ENV: 'cloud',
      RESEARCHHUB_API_BASE_URL: 'http://localhost:8080',
    }),
  ).toThrow();
  expect(() => browserPolicy({ RESEARCHHUB_DEPLOYMENT_ENV: 'unexpected' })).toThrow();
});
