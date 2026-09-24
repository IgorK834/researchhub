import { ApiError } from './apiError';
import { decodeProblemDetail, synthesizeProblemDetail } from './parseProblemDetail';

describe('decodeProblemDetail', () => {
  it('decodes the documented not-found body', () => {
    // Body copied from docs/development/api-errors.md.
    const problem = decodeProblemDetail(
      {
        type: 'about:blank',
        title: 'Not found',
        status: 404,
        detail: 'Workspace was not found',
        code: 'RESOURCE_NOT_FOUND',
      },
      404,
    );

    expect(problem).not.toBeNull();
    expect(problem?.code).toBe('RESOURCE_NOT_FOUND');
    expect(problem?.status).toBe(404);
    expect(problem?.detail).toBe('Workspace was not found');
    expect(problem?.errors).toBeUndefined();
  });

  it('decodes validation field errors', () => {
    const problem = decodeProblemDetail(
      {
        type: 'about:blank',
        title: 'Validation failed',
        status: 400,
        detail: 'Request validation failed',
        code: 'VALIDATION_FAILED',
        errors: [{ field: 'name', message: 'must not be blank' }],
      },
      400,
    );

    expect(problem?.code).toBe('VALIDATION_FAILED');
    expect(problem?.errors).toEqual([{ field: 'name', message: 'must not be blank' }]);
  });

  it('drops malformed entries in errors but keeps valid ones', () => {
    const problem = decodeProblemDetail(
      {
        code: 'VALIDATION_FAILED',
        status: 400,
        errors: [
          { field: 'name' },
          'nonsense',
          { field: 'email', message: 'must be an email' },
        ],
      },
      400,
    );

    expect(problem?.errors).toEqual([{ field: 'email', message: 'must be an email' }]);
  });

  it('decodes currentRevision on a stale-revision conflict', () => {
    // Body shape from docs/development/api-errors.md.
    const problem = decodeProblemDetail(
      {
        type: 'about:blank',
        title: 'Conflict',
        status: 409,
        detail:
          'This document was changed by somebody else. It is now at revision 2, and your copy is at ' +
          'revision 1. Reload it and apply your changes again.',
        code: 'CONFLICT',
        currentRevision: 2,
      },
      409,
    );

    expect(problem?.code).toBe('CONFLICT');
    expect(problem?.currentRevision).toBe(2);
  });

  it('accepts a conflict without currentRevision', () => {
    const problem = decodeProblemDetail(
      {
        type: 'about:blank',
        title: 'Conflict',
        status: 409,
        detail: 'This document is archived and cannot be changed',
        code: 'CONFLICT',
      },
      409,
    );

    expect(problem?.code).toBe('CONFLICT');
    expect(problem?.detail).toBe('This document is archived and cannot be changed');
    expect(problem).not.toHaveProperty('currentRevision');
  });

  it('ignores a currentRevision that is not a positive integer', () => {
    for (const currentRevision of ['2', 0, -1, 1.5, null, {}]) {
      const problem = decodeProblemDetail(
        {
          title: 'Conflict',
          status: 409,
          detail: 'Conflict',
          code: 'CONFLICT',
          currentRevision,
        },
        409,
      );
      expect(problem).not.toHaveProperty('currentRevision');
    }
  });

  it('maps an unrecognised code to UNKNOWN while preserving the raw value', () => {
    const problem = decodeProblemDetail(
      { code: 'SOME_FUTURE_CODE', status: 418, title: 'Teapot', detail: 'Nope' },
      418,
    );

    expect(problem?.code).toBe('UNKNOWN');
    expect(problem?.rawCode).toBe('SOME_FUTURE_CODE');
  });

  it('falls back to the HTTP status when the body omits status', () => {
    const problem = decodeProblemDetail({ code: 'INTERNAL_ERROR' }, 500);

    expect(problem?.status).toBe(500);
  });

  it('returns null for values that are not problem details', () => {
    expect(decodeProblemDetail(null, 500)).toBeNull();
    expect(decodeProblemDetail('<html>502 Bad Gateway</html>', 502)).toBeNull();
    expect(decodeProblemDetail(['a'], 500)).toBeNull();
    expect(decodeProblemDetail({ unrelated: true }, 500)).toBeNull();
  });
});

describe('synthesizeProblemDetail', () => {
  it('produces an UNKNOWN problem carrying the HTTP status', () => {
    const problem = synthesizeProblemDetail(502, 'Bad Gateway');

    expect(problem.code).toBe('UNKNOWN');
    expect(problem.status).toBe(502);
    expect(problem.title).toBe('Bad Gateway');
  });
});

describe('ApiError', () => {
  it('exposes code, status, and field errors from the problem body', () => {
    const problem = decodeProblemDetail(
      {
        title: 'Validation failed',
        status: 400,
        detail: 'Request validation failed',
        code: 'VALIDATION_FAILED',
        errors: [{ field: 'name', message: 'must not be blank' }],
      },
      400,
    );
    const error = new ApiError(problem!);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ApiError');
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.status).toBe(400);
    expect(error.message).toBe('Request validation failed');
    expect(error.fieldErrors).toHaveLength(1);
  });

  it('reports no field errors for non-validation codes', () => {
    const error = new ApiError(synthesizeProblemDetail(500, 'Internal Server Error'));

    expect(error.fieldErrors).toEqual([]);
  });
});
