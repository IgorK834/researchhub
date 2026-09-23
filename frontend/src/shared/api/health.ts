import { apiClient } from './apiClient';

/**
 * Actuator health status. `management.endpoint.health.show-details` is `never`, so the body
 * carries a status and probe group names only — no connection details.
 * See docs/development/health.md.
 */
export interface HealthResponse {
  readonly status: string;
  readonly groups?: readonly string[];
}

/**
 * Sample endpoint proving the shared client end to end. `UP` is HTTP 200; `DOWN` and
 * `OUT_OF_SERVICE` are HTTP 503 and therefore surface as an {@link import('./apiError').ApiError}.
 */
export function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return apiClient.get<HealthResponse>('/actuator/health', {
    ...(signal === undefined ? {} : { signal }),
  });
}
