import test from 'node:test';
import assert from 'node:assert/strict';
import { positiveInteger, validateSeed, thresholds, mixedRoute } from '../k6/lib/configuration.js';

test('bounded load configuration rejects unsafe or fractional VU counts', () => {
  assert.equal(positiveInteger(undefined, 5), 5);
  assert.equal(positiveInteger('', 5), 5);
  assert.equal(positiveInteger('200', 5), 200);
  for (const value of ['0', '-1', '201', 'NaN', '1.5']) assert.throws(() => positiveInteger(value, 5));
});
test('only distinct pre-created synthetic users are admitted', () => {
  const seed = { workspaceId: 'w', documentId: 'd', users: [{email:'load-001@rc-demo.example.test', password:'generated'}] };
  assert.equal(validateSeed(seed, 1).length, 1);
  assert.throws(() => validateSeed({}, 1));
  assert.throws(() => validateSeed({...seed, users: null}, 1));
  assert.throws(() => validateSeed(seed, 2));
  assert.throws(() => validateSeed({...seed, users: [...seed.users, ...seed.users]}, 2));
  assert.throws(() => validateSeed({...seed, users: [{email:'real@private.test', password:'secret'}]}, 1));
  assert.throws(() => validateSeed({...seed, users: [{email:'load-001@rc-demo.example.test'}]}, 1));
});
test('thresholds enforce errors and use only recorded endpoint latency budgets', () => {
  assert.equal(Object.keys(thresholds()).length, 3);
  assert.deepEqual(thresholds({'workspace-list': 500})['http_req_duration{endpoint:workspace-list,phase:run}'], ['p(95)<500']);
  for (const budget of [{'bad tag':500}, {'workspace-list':0}, {'workspace-list':NaN}]) assert.throws(() => thresholds(budget));
});
test('weighted mixed scenario keeps generation outside read traffic', () => {
  assert.equal(mixedRoute(0), 'api-read');
  assert.equal(mixedRoute(0.799), 'api-read');
  assert.equal(mixedRoute(0.8), 'workspace');
  assert.equal(mixedRoute(0.949), 'workspace');
  assert.equal(mixedRoute(0.95), 'retrieval');
  assert.throws(() => mixedRoute(-0.1));
  assert.throws(() => mixedRoute(1));
});
