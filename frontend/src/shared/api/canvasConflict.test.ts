import { decodeProblemDetail } from './parseProblemDetail';
it.each(['TARGET_STALE', 'NOT_SYNCHRONIZED'])(
  'decodes the bounded canvas conflict reason %s',
  (reason) => {
    expect(decodeProblemDetail({ code: 'CONFLICT', reason }, 409)?.reason).toBe(reason);
  },
);
it('does not trust arbitrary reasons or a reason on a different error', () => {
  expect(
    decodeProblemDetail({ code: 'CONFLICT', reason: 'unknown' }, 409)?.reason,
  ).toBeUndefined();
  expect(
    decodeProblemDetail({ code: 'FORBIDDEN', reason: 'TARGET_STALE' }, 403)?.reason,
  ).toBeUndefined();
});
