/// <reference types="node" />
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss from 'postcss';

const source = resolve(__dirname, '..');
const tokens = postcss.parse(readFileSync(resolve(__dirname, 'tokens.css'), 'utf8'));
const values: Record<string, string> = {};
tokens.walkRules(':root', (rule) => {
  if (rule.parent?.type === 'root') {
    rule.walkDecls((decl) => {
      values[decl.prop] = decl.value;
    });
  }
});

function value(name: string): string {
  const raw = values[name];
  if (raw === undefined) throw new Error(`Missing token ${name}`);
  return raw.replace(/var\((--[\w-]+)\)/g, (_, reference: string) => value(reference));
}

function luminance(hex: string): number {
  const rgb = [1, 3, 5].map(
    (offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255,
  );
  const linear = rgb.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
}

function contrast(text: string, surface: string): number {
  const pair = [luminance(value(text)), luminance(value(surface))].sort((a, b) => b - a);
  return (pair[0]! + 0.05) / (pair[1]! + 0.05);
}

it('preserves every stated palette swatch and measured mid-tint from the design', () => {
  const spec = readFileSync(
    resolve(source, '../../design-reference/DESIGN_SPEC.md'),
    'utf8',
  );
  for (const hue of ['blue', 'coral', 'lavender', 'mint', 'yellow']) {
    const row = spec.split('\n').find((line) => line.startsWith(`| \`brand-${hue}\``))!;
    const swatches = [...row.matchAll(/#[\da-f]{6}/gi)].map((match) =>
      match[0].toLowerCase(),
    );
    expect(
      ['', '-tint', '-mid', '-ink'].map((suffix) =>
        value(`--color-brand-${hue}${suffix}`),
      ),
    ).toEqual(swatches);
  }
  for (const name of [
    'background',
    'surface',
    'surface-muted',
    'border',
    'border-strong',
    'text-primary',
    'text-secondary',
    'text-muted',
  ]) {
    const row = spec.split('\n').find((line) => line.startsWith(`| \`${name}\` |`))!;
    expect(value(`--color-${name}`)).toBe(row.match(/#[\da-f]{6}/i)![0].toLowerCase());
  }
});

it('keeps all body, caption, link and enabled control text at or above 4.5:1', () => {
  for (const text of [
    'text-primary',
    'text-secondary',
    'text-subtle',
    'brand-blue-ink',
  ]) {
    for (const surface of ['background', 'surface', 'surface-muted']) {
      expect(contrast(`--color-${text}`, `--color-${surface}`)).toBeGreaterThanOrEqual(
        4.5,
      );
    }
  }
  for (const hue of ['blue', 'coral', 'lavender', 'mint', 'yellow']) {
    for (const surface of ['tint', 'mid']) {
      expect(
        contrast(`--color-brand-${hue}-ink`, `--color-brand-${hue}-${surface}`),
      ).toBeGreaterThanOrEqual(4.5);
    }
  }
  for (const fill of ['text-primary', 'action-hover', 'error-ink', 'danger-hover']) {
    expect(contrast('--color-surface', `--color-${fill}`)).toBeGreaterThanOrEqual(4.5);
  }
  // The original muted swatch is a palette reference, unsuitable for wells.
  expect(contrast('--color-text-muted', '--color-surface-muted')).toBeLessThan(4.5);
  for (const status of ['success', 'warning', 'error']) {
    expect(
      contrast(`--color-${status}-ink`, `--color-${status}-tint`),
    ).toBeGreaterThanOrEqual(4.5);
  }
});

it('provides the complete type, spacing, radius, elevation and focus contract', () => {
  const sizes = {
    display: 56,
    h1: 32,
    h2: 24,
    h3: 18,
    body: 15,
    label: 13,
    caption: 12,
    'paper-title': 28,
  };
  for (const [role, px] of Object.entries(sizes)) {
    expect(parseFloat(value(`--type-${role}-size`)) * 16).toBe(px);
    expect(value(`--type-${role}-weight`)).toMatch(/^[4-8]00$/);
  }
  expect(value('--font-ui')).toContain('Plus Jakarta Sans');
  expect(value('--font-paper')).toContain('Source Serif 4');
  expect([1, 2, 3, 4, 5, 6, 7, 8].map((n) => value(`--space-${n}`))).toEqual([
    '4px',
    '8px',
    '12px',
    '16px',
    '24px',
    '32px',
    '48px',
    '64px',
  ]);
  expect(['sm', 'md', 'lg', 'xl', 'pill'].map((n) => value(`--radius-${n}`))).toEqual([
    '6px',
    '10px',
    '16px',
    '24px',
    '999px',
  ]);
  for (const level of [0, 1, 2, 3]) expect(value(`--elevation-e${level}`)).toBeTruthy();
  expect(value('--focus-ring-width')).toBe('2px');
  expect(value('--focus-ring-gap')).toBe('2px');
  expect(value('--focus-field-halo')).toContain('0 0 0 3px');
  expect(
    ['compact', 'default', 'large'].map((n) => value(`--control-height-${n}`)),
  ).toEqual(['34px', '36px', '44px']);
});

it('turns off short, illustration and busy motion for reduced-motion users', () => {
  const reduced: Record<string, string> = {};
  tokens.walkAtRules('media', (rule) => {
    expect(rule.params).toBe('(prefers-reduced-motion: reduce)');
    rule.walkDecls((decl) => {
      reduced[decl.prop] = decl.value;
    });
  });
  for (const name of [
    'fast',
    'standard',
    'blink-duration',
    'paper-duration',
    'highlight-duration',
    'busy-duration',
  ]) {
    expect(reduced[`--motion-${name}`]).toBe('0ms');
  }
  expect(value('--motion-blink-duration')).toBe('120ms');
  expect(value('--motion-blink-interval-min')).toBe('5s');
  expect(value('--motion-blink-interval-max')).toBe('7s');
  expect(value('--motion-paper-duration')).toBe('2.4s');
  expect(value('--motion-highlight-duration')).toBe('400ms');
  expect(value('--motion-iteration-count')).toBe('1');
});

it('defines every CSS variable reference and confines raw colors to tokens.css', () => {
  const files = readdirSync(source, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.css'))
    .map((entry) => resolve(entry.parentPath, entry.name));
  const known = new Set(Object.keys(values));
  for (const file of files) {
    postcss.parse(readFileSync(file, 'utf8')).walkDecls((decl) => {
      if (decl.prop.startsWith('--')) known.add(decl.prop);
    });
  }
  for (const file of files) {
    const css = readFileSync(file, 'utf8');
    for (const reference of css.matchAll(/var\((--[\w-]+)/g))
      expect(known.has(reference[1]!)).toBe(true);
    if (!file.endsWith('/tokens.css'))
      expect(css).not.toMatch(/#[\da-f]{3,8}\b|(?:rgb|hsl)a?\(/i);
  }
});
