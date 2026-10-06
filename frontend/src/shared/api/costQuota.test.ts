import { ApiError, describeError } from './apiError';
import { decodeProblemDetail } from './parseProblemDetail';

const quota = {
  code: 'RATE_LIMIT_EXCEEDED',
  status: 429,
  detail: 'The request limit for this operation has been reached.',
  retryAfterSeconds: 60,
  quotaCategory: 'LLM',
};
it('decodes a stable quota response and gives the user an explicit retry delay', () => {
  const problem = decodeProblemDetail(quota, 429);
  expect(problem?.code).toBe('RATE_LIMIT_EXCEEDED');
  expect(problem?.quotaCategory).toBe('LLM');
  expect(problem?.retryAfterSeconds).toBe(60);
  expect(describeError(new ApiError(problem!))).toBe(
    `${quota.detail} Try again in 60 seconds.`,
  );
});
it.each([0, -1, 1.5, 86401, '60', null])(
  'ignores an invalid retry delay %s',
  (retryAfterSeconds) => {
    const problem = decodeProblemDetail(
      { ...quota, retryAfterSeconds, quotaCategory: 'UNKNOWN' },
      429,
    );
    expect(problem?.retryAfterSeconds).toBeUndefined();
    expect(problem?.quotaCategory).toBeUndefined();
    expect(describeError(new ApiError(problem!))).toBe(quota.detail);
  },
);
it('does not trust quota timing on other errors', () => {
  expect(
    decodeProblemDetail({ ...quota, code: 'FORBIDDEN' }, 403)?.retryAfterSeconds,
  ).toBeUndefined();
  for (const quotaCategory of ['ANALYSIS', 'RETRIEVAL']) {
    expect(decodeProblemDetail({ ...quota, quotaCategory }, 429)?.quotaCategory).toBe(
      quotaCategory,
    );
  }
});
