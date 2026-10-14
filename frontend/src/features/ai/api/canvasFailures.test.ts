import { canvasFailure, canvasPollDelay, describeCanvasFailure } from './canvasFailures';
import { ApiError } from '../../../shared/api';
import { setLocale } from '../../../shared/i18n';
beforeEach(() => setLocale('pl'));
afterEach(() => setLocale('en'));

test.each([
  'RATE_LIMIT_EXCEEDED',
  'FORBIDDEN',
  'RESOURCE_NOT_FOUND',
  'UNAUTHENTICATED',
  'AI_UNAVAILABLE',
  'AI_REFUSED',
  'CONFLICT',
  'AI_OUTPUT_INVALID',
] as const)('concrete Polish failure for %s', (code) => {
  expect(canvasFailure(code)).not.toMatch(/Error:|Execution failed/);
  expect(canvasFailure(code).length).toBeGreaterThan(60);
});
test('exact invalid format guidance and safe unknown failure', () => {
  expect(canvasFailure('AI_OUTPUT_INVALID')).toBe(
    'AI zwróciło odpowiedź w nieprawidłowym formacie. Dokument nie został zmieniony. Spróbuj ponownie.',
  );
  expect(describeCanvasFailure(new Error('private provider output'))).not.toContain(
    'private',
  );
  expect(
    describeCanvasFailure(
      new ApiError({
        type: 'about:blank',
        title: 'failure',
        status: 429,
        detail: 'private',
        code: 'RATE_LIMIT_EXCEEDED',
        rawCode: 'RATE_LIMIT_EXCEEDED',
      }),
    ),
  ).toContain('limit');
  expect(
    describeCanvasFailure(
      new ApiError({
        type: 'about:blank',
        title: 'failure',
        status: 500,
        detail: 'private',
        code: 'UNKNOWN',
        rawCode: 'NEW',
      }),
    ),
  ).toContain('historii');
});
test('backoff caps and stops at terminal or error state', () => {
  expect(canvasPollDelay(true, 1, false)).toBe(2000);
  expect(canvasPollDelay(true, 4, false)).toBe(4000);
  expect(canvasPollDelay(true, 100, false)).toBe(16000);
  expect(canvasPollDelay(false, 1, false)).toBe(false);
  expect(canvasPollDelay(true, 1, true)).toBe(false);
});
