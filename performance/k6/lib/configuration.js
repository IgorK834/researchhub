export function positiveInteger(value, fallback, maximum = 200) {
  const number = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isInteger(number) || number < 1 || number > maximum) {
    throw new Error(`Expected an integer between 1 and ${maximum}`);
  }
  return number;
}

export function validateSeed(seed, count) {
  if (!seed.workspaceId || !seed.documentId || !Array.isArray(seed.users) || seed.users.length < count) {
    throw new Error('Supply SEED_FILE from scripts/demo/seed.sh with enough pre-created synthetic users');
  }
  const users = seed.users.slice(0, count);
  if (new Set(users.map((user) => user.email)).size !== count ||
      users.some((user) => !user.email.endsWith('@rc-demo.example.test') || !user.password)) {
    throw new Error('Only unique project-authored synthetic accounts are allowed');
  }
  return users;
}

export function thresholds(baseline = {}) {
  const values = {
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
    authentication_failures: ['count==0'],
  };
  for (const [endpoint, milliseconds] of Object.entries(baseline)) {
    if (!/^[a-z-]+$/.test(endpoint) || !Number.isFinite(milliseconds) || milliseconds <= 0) {
      throw new Error('Invalid recorded endpoint baseline');
    }
    values[`http_req_duration{endpoint:${endpoint},phase:run}`] = [`p(95)<${milliseconds}`];
  }
  return values;
}

export function mixedRoute(random) {
  if (random < 0 || random >= 1) throw new Error('Random value must be in [0, 1)');
  return random < 0.8 ? 'api-read' : random < 0.95 ? 'workspace' : 'retrieval';
}
