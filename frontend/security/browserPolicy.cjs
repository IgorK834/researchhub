/** Production response-header contract. The HTTPS-only group is applied only at a trusted TLS edge. */
const { URL } = require('node:url');
function browserPolicy(env = {}) {
  const deployment = env.RESEARCHHUB_DEPLOYMENT_ENV ?? 'local';
  if (!['local', 'cloud'].includes(deployment))
    throw new Error('RESEARCHHUB_DEPLOYMENT_ENV must be local or cloud');
  const connect = new Set(["'self'"]);
  const origins = [
    env.RESEARCHHUB_API_BASE_URL ?? '',
    ...(env.RESEARCHHUB_CSP_CONNECT_ORIGINS ?? '').split(','),
  ];
  for (const value of origins.filter(Boolean)) {
    const url = new URL(value);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (
      url.origin !== value ||
      value.includes('*') ||
      url.username ||
      url.password ||
      !(
        ['https:', 'wss:'].includes(url.protocol) ||
        (deployment === 'local' && loopback && ['http:', 'ws:'].includes(url.protocol))
      )
    )
      throw new Error(
        'CSP connections require exact HTTPS/WSS origins; HTTP/WS loopback only locally',
      );
    connect.add(value);
  }
  const directives = [
    "default-src 'none'",
    "script-src 'self'",
    "script-src-attr 'none'",
    "style-src 'self'",
    // React progress widths and ProseMirror node/caret positioning use style attributes.
    // This exception does not allow inline style elements or inline scripts.
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' blob:",
    "font-src 'self'",
    `connect-src ${[...connect].join(' ')}`,
    "object-src 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ];
  return {
    schemaVersion: '1.0',
    deployment,
    headers: {
      'Content-Security-Policy': [...directives, "frame-ancestors 'none'"].join('; '),
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    },
    httpsOnlyHeaders:
      deployment === 'cloud' ? { 'Strict-Transport-Security': 'max-age=31536000' } : {},
    // frame-ancestors requires an HTTP response header; the meta policy is only a fallback.
    metaCsp: directives.join('; '),
  };
}

module.exports = { browserPolicy };
