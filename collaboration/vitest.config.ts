import {defineConfig} from 'vitest/config';
export default defineConfig({test: {coverage: {provider: 'v8', include: ['src/**/*.ts'], exclude: ['src/main.ts'], thresholds: {perFile: true, lines: 80, functions: 80, statements: 80, branches: 80}}, testTimeout: 15000}});
