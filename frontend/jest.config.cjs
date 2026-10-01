/**
 * Jest is used instead of Vitest because Vitest would pull Vite into the toolchain, and this
 * project deliberately does not use Vite (docs/context.md section 5.2). `babel-jest` reuses
 * babel.config.cjs, so tests are transformed exactly like the Webpack build.
 *
 * Component tests opt into jsdom. The source feature and its preview modules have explicit
 * coverage gates alongside the shared API transport checks.
 */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  setupFiles: ['<rootDir>/jest.setup.cjs'],
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  collectCoverageFrom: [
    'src/shared/api/**/*.ts',
    '!src/shared/api/index.ts',
    'src/features/sources/**/*.{ts,tsx}',
    'src/features/analysis/**/*.{ts,tsx}',
    'src/features/ai/**/*.{ts,tsx}',
    'src/features/documents/api/researchCitation.ts',
  ],
  coverageThreshold: {
    'src/features/ai/api/sourceAnalysisApi.ts': {
      lines: 80,
      branches: 80,
      functions: 80,
      statements: 80,
    },
    'src/features/ai/components/SourceComparisonPanel.tsx': {
      lines: 80,
      functions: 80,
      statements: 80,
    },
    'src/features/documents/api/researchCitation.ts': {
      lines: 80,
      functions: 80,
      statements: 80,
    },
    'src/features/ai/components/AuthoringPanel.tsx': {
      lines: 80,
      functions: 80,
      statements: 80,
    },
    'src/features/ai/api/authoringApi.ts': {
      lines: 80,
      branches: 80,
      functions: 80,
      statements: 80,
    },
    'src/features/ai/': { lines: 80, branches: 80, functions: 80, statements: 80 },
    'src/features/sources/': { lines: 80, branches: 80, functions: 80, statements: 80 },
    'src/features/sources/components/CsvAssetProfile.tsx': {
      lines: 80,
      branches: 80,
      functions: 80,
      statements: 80,
    },
    'src/features/sources/api/sourceLocations.ts': {
      lines: 80,
      branches: 80,
      functions: 80,
      statements: 80,
    },
    'src/features/sources/components/PdfSourcePreview.tsx': {
      lines: 80,
      branches: 80,
      functions: 80,
      statements: 80,
    },
    'src/features/sources/components/SourceProcessing.tsx': {
      lines: 80,
      branches: 80,
      functions: 80,
      statements: 80,
    },
    'src/features/sources/components/SourceExtractionPreview.tsx': {
      lines: 80,
      branches: 80,
      functions: 80,
      statements: 80,
    },
    'src/features/sources/api/sourceExtraction.ts': {
      lines: 80,
      functions: 80,
      statements: 80,
    },
    'src/features/analysis/': { lines: 80, branches: 80, functions: 80, statements: 80 },
  },
};
