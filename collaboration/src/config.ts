export interface Config {
  host?: string;
  port: number;
  backendUrl: string;
  serviceToken: string;
  allowedOrigins: string[];
  recheckMs: number;
}
export function configuration(env: NodeJS.ProcessEnv = process.env): Config {
  const host = env.COLLABORATION_HOST ?? '0.0.0.0';
  const port = Number(env.COLLABORATION_PORT ?? 8091);
  const backendUrl = env.COLLABORATION_BACKEND_URL ?? 'http://127.0.0.1:8080';
  const serviceToken = env.COLLABORATION_SERVICE_TOKEN ?? '';
  const allowedOrigins = (env.COLLABORATION_ALLOWED_ORIGINS ?? 'http://localhost:3000').split(',');
  const recheckMs = Number(env.COLLABORATION_RECHECK_MS ?? 5000);
  const url = new URL(backendUrl);
  if (!['0.0.0.0', '127.0.0.1'].includes(host) || !Number.isInteger(port) || port < 0 || port > 65535 || serviceToken.length < 32
    || !['http:', 'https:'].includes(url.protocol) || url.username || url.password
    || url.search || url.hash || allowedOrigins.includes('*') || allowedOrigins.some(origin => new URL(origin).origin !== origin)
    || !Number.isInteger(recheckMs) || recheckMs < 100 || recheckMs > 5000) {
    throw new Error('Invalid collaboration configuration');
  }
  return {host, port, backendUrl, serviceToken, allowedOrigins, recheckMs};
}
