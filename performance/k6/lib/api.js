import http from 'k6/http';
import { check, fail, sleep } from 'k6';
import { Counter } from 'k6/metrics';
import { positiveInteger, thresholds, validateSeed } from './configuration.js';

const seed = __ENV.SEED_FILE ? JSON.parse(open(__ENV.SEED_FILE)) : {};
const baseline = JSON.parse(open('./baseline.json'));
const authFailures = new Counter('authentication_failures');
const replicas = new Counter('replica_requests');
const base = (__ENV.BASE_URL || 'http://127.0.0.1:18080').replace(/\/$/, '');
let sessionInstalled = false;
export const groundedQuestion = 'What time constant should we expect from the component values?';

export function options(vus, duration) {
  return {
    vus: positiveInteger(__ENV.VUS, vus),
    duration: __ENV.DURATION || duration,
    setupTimeout: '5m',
    thresholds: thresholds(baseline.p95ms),
    summaryTrendStats: ['avg', 'min', 'med', 'p(50)', 'p(95)', 'p(99)', 'max'],
    noCookiesReset: true,
  };
}

export function prepare(count) {
  const users = validateSeed(seed, count);
  const jar = http.cookieJar();
  const sessions = users.map((user) => {
    jar.clear(base);
    let response = http.get(base + '/api/auth/csrf', { tags: { endpoint: 'csrf', phase: 'setup' } });
    if (response.status !== 204) fail('CSRF bootstrap failed');
    let csrf = jar.cookiesForURL(base)['XSRF-TOKEN'][0];
    response = http.post(base + '/api/auth/login', JSON.stringify(user), {
      headers: { 'Content-Type': 'application/json', 'X-XSRF-TOKEN': decodeURIComponent(csrf) },
      tags: { endpoint: 'login', phase: 'setup' },
    });
    if (response.status !== 200) fail('Synthetic account login failed');
    response = http.get(base + '/api/auth/csrf', { tags: { endpoint: 'csrf', phase: 'setup' } });
    if (response.status !== 204) fail('Post-login CSRF refresh failed');
    const cookies = jar.cookiesForURL(base);
    return { cookies, csrf: decodeURIComponent(cookies['XSRF-TOKEN'][0]) };
  });
  const model = http.get(base + `/api/workspaces/${seed.workspaceId}/ai/model`, {
    tags: { endpoint: 'model', phase: 'setup' },
  });
  if (model.status !== 200 || model.json().provider !== 'deterministic') {
    fail('Load is allowed only with AI_WORKER_MODEL_PROVIDER=deterministic');
  }
  return { sessions, workspaceId: seed.workspaceId, documentId: seed.documentId };
}

function session(data) {
  const selected = data.sessions[__VU - 1];
  if (!selected) fail('Each VU needs its own pre-created synthetic session');
  if (!sessionInstalled) {
    const jar = http.cookieJar();
    for (const [name, values] of Object.entries(selected.cookies)) {
      jar.set(base, name, values[0], { path: '/' });
    }
    sessionInstalled = true;
  }
  return selected;
}

export function request(data, endpoint, path, body) {
  const selected = session(data);
  const parameters = {
    headers: { 'Content-Type': 'application/json', 'X-XSRF-TOKEN': selected.csrf },
    tags: { endpoint, phase: 'run', name: endpoint },
  };
  const response = body === undefined ? http.get(base + path, parameters) :
    http.post(base + path, JSON.stringify(body), parameters);
  authFailures.add(response.status === 401 || response.status === 403 ? 1 : 0);
  const replica = response.headers['X-Replica-Id'];
  replicas.add(1, { replica: ['backend-1', 'backend-2'].includes(replica) ? replica : 'other', endpoint });
  check(response, { 'endpoint succeeds': (value) => value.status === 200 }, { endpoint });
  return response;
}

export function readApi(data) {
  const route = `/api/workspaces/${data.workspaceId}`;
  request(data, 'workspace-list', '/api/workspaces');
  request(data, 'workspace-detail', route);
  request(data, 'source-list', route + '/sources');
  request(data, 'document-read', route + '/documents/' + data.documentId);
  request(data, 'audit-read', route + '/audit-events?limit=20');
  request(data, 'analysis-history', route + '/analyses');
}

export function readWorkspace(data) {
  const route = `/api/workspaces/${data.workspaceId}`;
  request(data, 'workspace-list', '/api/workspaces');
  request(data, 'workspace-detail', route);
  request(data, 'workspace-members', route + '/members');
}

export function retrieval(data) {
  const response = request(data, 'workspace-question', `/api/workspaces/${data.workspaceId}/ai/questions`,
    { question: groundedQuestion });
  check(response, { 'answer has source citations': (value) => value.status === 200 &&
    value.json().status === 'SUPPORTED' && value.json().citations.length > 0 }, { endpoint: 'workspace-question' });
}

export function pause(defaultSeconds = 1) {
  sleep(Number(__ENV.THINK_TIME || defaultSeconds));
}
