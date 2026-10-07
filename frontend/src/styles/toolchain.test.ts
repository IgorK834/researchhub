/** @jest-environment jsdom */
/// <reference types="node" />
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import svgUrl from './__fixtures__/contract.svg';
import fontUrl from '@fontsource-variable/plus-jakarta-sans/files/plus-jakarta-sans-latin-wght-normal.woff2';

const frontend = resolve(__dirname, '../..');
const { execPath } = jest.requireActual<{ execPath: string }>('node:process');

it('supports typed SVG and font URL imports in Jest', () => {
  const assets: readonly string[] = [svgUrl, fontUrl];
  expect(assets).toEqual(['/assets/test-asset', '/assets/test-asset']);
});

it.each(['development', 'production'])(
  'compiles global CSS, scoped CSS, real font files and SVG URLs in %s',
  (mode) => {
    const directory = mkdtempSync(resolve(tmpdir(), 'researchhub-assets-'));
    writeFileSync(
      resolve(directory, 'entry.mjs'),
      [
        `import ${JSON.stringify(resolve(frontend, 'src/styles/index.css'))};`,
        `import classes from ${JSON.stringify(resolve(frontend, 'src/shared/components/Button.module.css'))};`,
        `import asset from ${JSON.stringify(resolve(__dirname, '__fixtures__/contract.svg'))};`,
        // Keep both imports observable in the bundle so production cannot prune them.
        'document.body.dataset.style = classes.button;',
        'document.body.dataset.dangerSoft = classes["danger-soft"];',
        'document.body.dataset.asset = asset;',
      ].join('\n'),
    );
    const configPath = resolve(directory, 'webpack.config.cjs');
    writeFileSync(
      configPath,
      `
    const config = require(${JSON.stringify(resolve(frontend, 'webpack.config.cjs'))})({}, { mode: ${JSON.stringify(mode)} });
    module.exports = {
      ...config,
      entry: ${JSON.stringify(resolve(directory, 'entry.mjs'))},
      output: { ...config.output, path: ${JSON.stringify(resolve(directory, 'dist'))} },
      devtool: false,
    };
  `,
    );
    try {
      // Run in native Node: loading Babel 8 inside Jest's VM is a different loader contract.
      const result = spawnSync(
        execPath,
        [
          resolve(frontend, 'node_modules/webpack-cli/bin/cli.js'),
          '--config',
          configPath,
          '--mode',
          mode,
        ],
        {
          cwd: frontend,
          encoding: 'utf8',
          timeout: 25000,
        },
      );
      if (result.status !== 0)
        throw new Error(result.error?.message ?? `${result.stdout}\n${result.stderr}`);
      const assets = readdirSync(resolve(directory, 'dist/assets'));
      const notices = readFileSync(
        resolve(directory, 'dist/THIRD_PARTY_NOTICES.txt'),
        'utf8',
      );
      expect(notices).toContain('SIL OPEN FONT LICENSE Version 1.1');
      expect(notices).toContain('ISC License');
      expect(notices).toContain('Cole Bemis');
      expect(assets.some((name) => /^contract\..+\.svg$/.test(name))).toBe(true);
      expect(
        assets.some(
          (name) =>
            name.startsWith('plus-jakarta-sans-latin-') && name.endsWith('.woff2'),
        ),
      ).toBe(true);
      expect(
        assets.some(
          (name) =>
            name.startsWith('source-serif-4-latin-ext-') && name.endsWith('.woff2'),
        ),
      ).toBe(true);
      const bundle = readdirSync(resolve(directory, 'dist')).find((name) =>
        name.endsWith('.js'),
      )!;
      const js = readFileSync(resolve(directory, 'dist', bundle), 'utf8');
      if (mode === 'production') {
        const css = readdirSync(resolve(directory, 'dist')).find((name) =>
          name.endsWith('.css'),
        )!;
        expect(readFileSync(resolve(directory, 'dist', css), 'utf8')).toContain(
          '--color-background',
        );
        expect(js).not.toContain('insertStyleElement');
        const html = readFileSync(resolve(directory, 'dist/index.html'), 'utf8');
        expect(html).toContain(css);
        expect(html).toMatch(/http-equiv=["']?Content-Security-Policy/);
      } else {
        expect(js).toContain('--color-background');
      }
      // Exercise actual loader exports: the Jest proxy cannot catch a renamed CSS key.
      window.eval(js);
      expect(document.body.dataset.style).toMatch(/^rh_/);
      expect(document.body.dataset.dangerSoft).toMatch(/^rh_/);
      expect(document.body.dataset.asset).toMatch(/^\/assets\/contract\.[\da-f]+\.svg$/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
  30000,
);
