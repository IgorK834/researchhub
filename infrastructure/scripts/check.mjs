import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { BICEP_VERSION } from './deployment.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const binary = process.env.BICEP_BIN;
const directory = mkdtempSync(join(tmpdir(), 'researchhub-bicep-'));
try {
  const run = args => {
    const result = spawnSync(binary || 'az', binary ? args.filter(arg => arg !== '--file') : ['bicep', ...args], { encoding: 'utf8' });
    if (result.error || result.status !== 0 || result.stderr.trim()) {
      throw new Error(result.stderr || 'Bicep command failed');
    }
    return result.stdout;
  };
  const version = run([binary ? '--version' : 'version']);
  if (!version.includes(`version ${BICEP_VERSION} `)) throw new Error(`Expected Bicep ${BICEP_VERSION}`);
  const sources = [join(root, 'main.bicep'), ...readdirSync(join(root, 'modules')).filter(name => name.endsWith('.bicep')).map(name => join(root, 'modules', name))];
  for (const source of sources) {
    run(['build', '--file', source, '--outfile', join(directory, source.split('/').at(-1) + '.json')]);
    run(['lint', '--file', source]);
  }
  console.log(`Built and linted ${sources.length} Bicep templates (${BICEP_VERSION}), no diagnostics`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  rmSync(directory, { recursive: true, force: true });
}
