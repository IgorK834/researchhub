import {
  checkSourceFile,
  DEFAULT_MAX_SOURCE_BYTES,
  SOURCE_FILE_ACCEPT,
  SOURCE_STATUS_LABELS,
  SOURCE_TYPE_RULES,
  SOURCE_TYPES,
  supportedTypesSentence,
} from './sourceTypes';

/**
 * The frontend's copy of the source type mapping. The wording is asserted exactly because it is meant to match
 * the server's `UNSUPPORTED_FILE_TYPE` and `PAYLOAD_TOO_LARGE` details, so a user reads the same sentence either way.
 */
describe('source types', () => {
  it('lists the five MVP types with one canonical media type each', () => {
    expect(SOURCE_TYPES).toEqual(['PDF', 'DOCX', 'XLSX', 'CSV', 'TXT']);
    expect(SOURCE_TYPE_RULES.CSV.mediaType).toBe('text/csv');
    for (const type of SOURCE_TYPES) {
      expect(SOURCE_TYPE_RULES[type].acceptedMediaTypes).toContain(
        SOURCE_TYPE_RULES[type].mediaType,
      );
    }
    expect(SOURCE_FILE_ACCEPT).toBe('.pdf,.docx,.xlsx,.csv,.txt');
    expect(SOURCE_STATUS_LABELS.FAILED).toBe('Processing failed');
  });

  it('words the supported list the way the server does', () => {
    expect(supportedTypesSentence()).toBe(
      'Supported types: PDF (.pdf), DOCX (.docx), XLSX (.xlsx), CSV (.csv), TXT (.txt).',
    );
  });
});

describe('checkSourceFile', () => {
  const file = (name: string, type: string, size = 100) => ({ name, type, size });

  it('recognises each type by its extension', () => {
    expect(checkSourceFile(file('Report.PDF', 'application/pdf'))).toEqual({
      ok: true,
      sourceType: 'PDF',
    });
    expect(
      checkSourceFile(
        file(
          'notes.docx',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ),
      ),
    ).toEqual({ ok: true, sourceType: 'DOCX' });
    expect(checkSourceFile(file('data.xlsx', ''))).toEqual({
      ok: true,
      sourceType: 'XLSX',
    });
    expect(checkSourceFile(file('data.csv', 'application/vnd.ms-excel'))).toEqual({
      ok: true,
      sourceType: 'CSV',
    });
    expect(checkSourceFile(file('readme.txt', 'text/plain; charset=utf-8'))).toEqual({
      ok: true,
      sourceType: 'TXT',
    });
    expect(
      checkSourceFile(file('C:\\fakepath\\x.pdf', 'application/octet-stream')),
    ).toEqual({
      ok: true,
      sourceType: 'PDF',
    });
  });

  it('refuses an unsupported extension with the server wording', () => {
    expect(checkSourceFile(file('slides.pptx', ''))).toEqual({
      ok: false,
      message:
        'Files of type .pptx are not supported. Supported types: PDF (.pdf), DOCX (.docx), ' +
        'XLSX (.xlsx), CSV (.csv), TXT (.txt).',
    });
  });

  it('refuses a file with no extension', () => {
    const result = checkSourceFile(file('README', 'text/plain'));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toMatch(/^The file has no extension/);
    expect(checkSourceFile(file('trailing.', '')).ok).toBe(false);
    expect(checkSourceFile(file('.bashrc', '')).ok).toBe(false);
  });

  it('refuses a media type that contradicts the extension', () => {
    const result = checkSourceFile(file('photo.pdf', 'image/png'));
    expect(!result.ok && result.message).toContain(
      'named .pdf but was sent as image/png',
    );
  });

  it('refuses an empty file and one over the limit', () => {
    expect(checkSourceFile(file('a.txt', 'text/plain', 0))).toEqual({
      ok: false,
      message: 'The file is empty',
    });
    expect(
      checkSourceFile(file('big.pdf', 'application/pdf', DEFAULT_MAX_SOURCE_BYTES + 1)),
    ).toEqual({
      ok: false,
      message: 'The file is larger than the 50 MB allowed for one source',
    });
    expect(checkSourceFile(file('big.pdf', 'application/pdf', 2048), 1024 ** 3).ok).toBe(
      true,
    );
    expect(checkSourceFile(file('big.pdf', 'application/pdf', 2048), 1000)).toEqual({
      ok: false,
      message: 'The file is larger than the 1000 bytes allowed for one source',
    });
    expect(
      checkSourceFile(file('big.pdf', 'application/pdf', 1024 ** 3 + 1), 1024 ** 3),
    ).toEqual({
      ok: false,
      message: 'The file is larger than the 1 GB allowed for one source',
    });
  });
});
