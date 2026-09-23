/**
 * Base origin for API requests, injected at build time from `RESEARCHHUB_API_BASE_URL`.
 *
 * Empty string (the default) means same-origin relative requests. In development the Webpack
 * dev server proxies `/api` and `/actuator` to the backend, so requests stay same-origin and
 * no backend CORS configuration is required.
 */
export const apiBaseUrl: string = process.env.RESEARCHHUB_API_BASE_URL ?? '';

/**
 * Joins the configured base URL with a request path.
 *
 * @param path Absolute request path beginning with `/`, for example `/actuator/health`.
 */
export function resolveApiUrl(path: string): string {
  if (!path.startsWith('/')) {
    throw new Error(`API path must start with "/": received "${path}"`);
  }

  if (apiBaseUrl === '') {
    return path;
  }

  return `${apiBaseUrl.replace(/\/+$/, '')}${path}`;
}
