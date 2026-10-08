import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const calls = [];
const counters = new Map();
let cookies = {};
let failure;
let csrfCalls = 0;
let replica = 'backend-1';
const response = (status, payload = {}) => ({ status, headers: { 'X-Replica-Id': replica }, json: () => payload });
const jar = {
  clear() { cookies = {}; csrfCalls = 0; },
  cookiesForURL() { return cookies; },
  set(base, name, value) { calls.push({ cookie: name, value }); cookies[name] = [value]; },
};
globalThis.__k6 = {
  http: {
    cookieJar: () => jar,
    get(url, parameters) {
      calls.push({ url, parameters });
      if (url.endsWith('/csrf')) {
        csrfCalls += 1;
        cookies['XSRF-TOKEN'] = ['csrf-' + csrfCalls];
        return response(failure === (csrfCalls === 1 ? 'csrf' : 'refresh') ? 500 : 204);
      }
      if (url.endsWith('/model')) return response(failure === 'model-http' ? 500 : 200, { provider: failure === 'paid' ? 'foundry' : 'deterministic' });
      return response(failure === 'unauthorized' ? 401 : failure === 'forbidden' ? 403 : 200);
    },
    post(url, body, parameters) {
      calls.push({ url, body: JSON.parse(body), parameters });
      if (url.endsWith('/login')) {
        cookies.JSESSIONID = ['session-' + calls.length];
        return response(failure === 'login' ? 401 : 200);
      }
      return response(200, { status: 'SUPPORTED', citations: failure === 'citations' ? [] : [{ sourceId: 'synthetic' }] });
    },
  },
  check(value, checks) { return Object.values(checks).every((check) => check(value)); },
  fail(message) { throw new Error(message); },
  sleep(seconds) { calls.push({ sleep: seconds }); },
  Counter: class {
    constructor(name) { this.name = name; counters.set(name, []); }
    add(value, tags) { counters.get(this.name).push({ value, tags }); }
  },
};
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('k6')) return { url: 'mock:' + specifier, shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    const source = url === 'mock:k6/http' ? 'export default globalThis.__k6.http;' :
      url === 'mock:k6/metrics' ? 'export const Counter = globalThis.__k6.Counter;' :
      url === 'mock:k6' ? 'export const { check, fail, sleep } = globalThis.__k6;' : undefined;
    return source ? { format: 'module', source, shortCircuit: true } : next(url, context);
  },
});
globalThis.__ENV = { SEED_FILE: 'synthetic-fixture', BASE_URL: 'http://synthetic/' };
globalThis.__VU = 1;
globalThis.open = (path) => JSON.stringify(path === 'synthetic-fixture' ? {
  workspaceId: 'workspace', documentId: 'document',
  users: Array.from({ length: 200 }, (_, index) => ({ email: `load-${index}@rc-demo.example.test`, password: 'generated-test-only' })),
} : { p95ms: {} });
const api = await import('../k6/lib/api.js');

test('setup creates distinct sessions once, refreshes CSRF and guards the provider', () => {
  calls.length = 0;
  const data = api.prepare(2);
  assert.equal(calls.filter((call) => call.url?.endsWith('/login')).length, 2);
  assert.notEqual(data.sessions[0].cookies.JSESSIONID[0], data.sessions[1].cookies.JSESSIONID[0]);
  assert.equal(data.sessions[0].csrf, 'csrf-2');
  assert.ok(calls.filter((call) => call.url).every((call) => call.parameters.tags.phase === 'setup'));
  for (const invalid of ['csrf', 'login', 'refresh', 'model-http', 'paid']) {
    failure = invalid;
    assert.throws(() => api.prepare(1));
  }
  failure = undefined;
});
test('runtime uses its own cookies, stable endpoint tags and counts every authentication rejection', () => {
  const data = api.prepare(2);
  calls.length = 0;
  api.readApi(data);
  assert.equal(calls.filter((call) => call.cookie).length, 2);
  assert.equal(calls.filter((call) => call.url).length, 6);
  assert.ok(calls.filter((call) => call.url).every((call) => call.parameters.tags.phase === 'run'));
  api.readWorkspace(data);
  api.retrieval(data);
  assert.equal(calls.filter((call) => call.cookie).length, 2, 'session is installed only once per VU');
  const question = calls.find((call) => call.body?.question);
  assert.equal(question.parameters.headers['X-XSRF-TOKEN'], data.sessions[0].csrf);
  assert.equal(question.body.question, api.groundedQuestion);
  failure = 'citations';
  api.retrieval(data);
  failure = 'unauthorized';
  api.request(data, 'read', '/read');
  failure = 'forbidden';
  replica = 'unexpected';
  api.request(data, 'read', '/read');
  assert.equal(counters.get('authentication_failures').filter((point) => point.value === 1).length, 2);
  assert.equal(counters.get('replica_requests').at(-1).tags.replica, 'other');
  __VU = 3;
  assert.throws(() => api.request(data, 'read', '/read'), /Each VU/);
  __VU = 1;
  failure = undefined;
  replica = 'backend-1';
  api.pause();
  api.pause(15);
  __ENV.THINK_TIME = '2';
  api.pause(15);
  assert.deepEqual(calls.filter((call) => call.sleep).map((call) => call.sleep), [1, 15, 2]);
  delete __ENV.THINK_TIME;
});
test('every scenario exports inspectable configuration and executes its intended path', async () => {
  assert.equal(api.options(5, '2m').duration, '2m');
  __ENV.DURATION = '1m';
  __ENV.VUS = '2';
  assert.equal(api.options(5, '2m').duration, '1m');
  delete __ENV.DURATION;
  delete __ENV.VUS;
  for (const scenario of ['smoke', 'api-read', 'workspace', 'retrieval', 'mixed-load']) {
    const module = await import('../k6/' + scenario + '.js');
    const data = module.setup();
    if (scenario === 'mixed-load') {
      const original = Math.random;
      try {
        for (const value of [0, .9, .99]) { Math.random = () => value; module.default(data); }
      } finally { Math.random = original; }
      assert.equal(module.options.stages.reduce((maximum, stage) => Math.max(maximum, stage.target), 0), 200);
    } else module.default(data);
  }
});
