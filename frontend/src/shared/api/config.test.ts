import { apiBaseUrl, resolveApiUrl } from './config';

describe('resolveApiUrl', () => {
  // Nothing defines RESEARCHHUB_API_BASE_URL under the test runner, which is the same situation
  // as a build that leaves it unset. It must degrade to same-origin, not to "undefined/...".
  it('defaults to same-origin relative paths when no base URL is configured', () => {
    expect(apiBaseUrl).toBe('');
    expect(resolveApiUrl('/actuator/health')).toBe('/actuator/health');
  });

  it('rejects a path that is not absolute', () => {
    expect(() => resolveApiUrl('actuator/health')).toThrow('must start with "/"');
  });
});

describe('resolveApiUrl with a configured base URL', () => {
  // `process.env` is declared read-only for the browser bundle, where DefinePlugin inlines the
  // value as a literal. Under the test runner it is a real, mutable Node environment.
  const mutableEnv = process.env as { RESEARCHHUB_API_BASE_URL?: string };

  const load = async (baseUrl: string): Promise<typeof import('./config')> => {
    mutableEnv.RESEARCHHUB_API_BASE_URL = baseUrl;
    jest.resetModules();
    return import('./config');
  };

  afterEach(() => {
    delete mutableEnv.RESEARCHHUB_API_BASE_URL;
    jest.resetModules();
  });

  it('prefixes the configured origin', async () => {
    const config = await load('http://localhost:8080');
    expect(config.resolveApiUrl('/api/workspaces')).toBe(
      'http://localhost:8080/api/workspaces',
    );
  });

  it('does not produce a double slash when the origin has a trailing slash', async () => {
    const config = await load('http://localhost:8080/');
    expect(config.resolveApiUrl('/api/workspaces')).toBe(
      'http://localhost:8080/api/workspaces',
    );
  });
});
