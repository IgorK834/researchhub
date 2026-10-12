import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/deploy.mjs', import.meta.url));
const run = (args, env = process.env) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env });

test('actual CLI validates public defaults without credentials and rejects usage/config errors', () => {
  const result = run([]);
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).connections, 20);
  assert.equal(run(['destroy']).status, 1);
  assert.equal(run(['validate', 'unused', 'extra']).status, 1);
  assert.match(run(['validate', '/nonexistent/researchhub-config.json']).stderr, /Cannot read configuration/);
  const directory = mkdtempSync(join(tmpdir(), 'researchhub-cli-test-'));
  try {
    const file = join(directory, 'config.json');
    writeFileSync(file, '{invalid');
    assert.match(run(['validate', file]).stderr, /Invalid configuration JSON/);
    writeFileSync(file, '{"environment":"production"}');
    assert.match(run(['validate', file]).stderr, /Only disposable dev/);
    assert.match(run(['deploy'], { ...process.env, AZURE_SUBSCRIPTION_ID: '' }).stderr, /AZURE_SUBSCRIPTION_ID/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('actual deployment CLI never replays provider errors containing credentials', () => {
  const directory = mkdtempSync(join(tmpdir(), 'researchhub-cli-test-'));
  const password = 'DoNotPrint0!'.repeat(4);
  try {
    // A private fake CLI provides a local end-to-end failure path; no Azure requests are made.
    writeFileSync(join(directory, 'az'), `#!${process.execPath}\nprocess.stderr.write(process.env.RH_DB_PASSWORD);process.exit(1);\n`, { mode: 0o700 });
    const result = run(['deploy'], { ...process.env, PATH: directory,
      AZURE_SUBSCRIPTION_ID: '11111111-2222-3333-4444-555555555555', RH_DB_PASSWORD: password });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Azure CLI failed/);
    assert.ok(!result.stderr.includes(password));
    assert.ok(!result.stdout.includes(password));
    const missing = run(['deploy'], { ...process.env, PATH: '/nonexistent/researchhub-path',
      AZURE_SUBSCRIPTION_ID: '11111111-2222-3333-4444-555555555555', RH_DB_PASSWORD: password });
    assert.match(missing.stderr, /Azure CLI failed/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
