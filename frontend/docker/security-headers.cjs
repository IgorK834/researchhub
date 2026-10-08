const fs = require('node:fs');
const policy = JSON.parse(fs.readFileSync('dist/security-headers.json', 'utf8'));
// Serve the exact response headers emitted by the existing build policy.
fs.writeFileSync('docker/security-headers.caddy', 'header {\n' +
  Object.entries(policy.headers).map(([name, value]) => `  ${name} ${JSON.stringify(value)}`).join('\n') + '\n}\n');
