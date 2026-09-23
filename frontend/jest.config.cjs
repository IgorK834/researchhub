/**
 * Jest is used instead of Vitest because Vitest would pull Vite into the toolchain, and this
 * project deliberately does not use Vite (docs/context.md section 5.2). `babel-jest` reuses
 * babel.config.cjs, so tests are transformed exactly like the Webpack build.
 *
 * Scope today: pure logic in `src/shared/api`. Component tests would additionally need
 * jest-environment-jsdom and @testing-library/react; that is not wired yet.
 */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  setupFiles: ['<rootDir>/jest.setup.cjs'],
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  collectCoverageFrom: ['src/shared/api/**/*.ts', '!src/shared/api/index.ts'],
};
