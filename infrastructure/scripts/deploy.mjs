import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { deploy, validateConfig } from './deployment.mjs';

try {
  const [mode = 'validate', file = fileURLToPath(new URL('../environments/dev.json', import.meta.url)), ...extra] = process.argv.slice(2);
  if (extra.length || !['validate', 'what-if', 'deploy'].includes(mode)) throw new Error('Usage: node infrastructure/scripts/deploy.mjs [validate|what-if|deploy] [config.json]');
  const config = JSON.parse(readFileSync(file, 'utf8'));
  const summary = validateConfig(config);
  if (mode === 'validate') console.log(JSON.stringify(summary, null, 2));
  else {
    const execute = args => {
      const result = spawnSync('az', args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
      // Provider diagnostics can contain supplied values. Never replay stderr or command parameters.
      if (result.error || result.status !== 0) throw new Error('Azure CLI failed; inspect the private Azure deployment diagnostics');
      return result.stdout;
    };
    console.log(deploy(mode, config, process.env, fileURLToPath(new URL('../main.bicep', import.meta.url)), execute));
  }
} catch (error) {
  console.error(error instanceof SyntaxError ? 'Invalid configuration JSON' : error.code ? 'Cannot read configuration file' : error.message);
  process.exitCode = 1;
}
