import { apiClient } from '../../../shared/api';
import { searchSourceText, passagePath, passageLocation } from './sourceTextSearch';
import { textHit } from '../testing/searchFixtures';
jest.mock('../../../shared/api', () => ({ apiClient: { get: jest.fn() } }));
const get = jest.mocked(apiClient.get);
beforeEach(() => get.mockReset());
it('uses only the scoped retrieval endpoint with an encoded query and cancellation', async () => {
  const signal = new AbortController().signal;
  get.mockResolvedValue([textHit()]);
  expect(await searchSourceText('w1', 'solar & 50%_?', signal)).toEqual([textHit()]);
  expect(get).toHaveBeenCalledWith(
    '/api/workspaces/w1/retrieval/search?query=solar+%26+50%25_%3F&topK=20',
    { signal },
  );
});
it('fails closed for a cross-workspace response and propagates retrieval errors', async () => {
  get.mockResolvedValue([
    { ...textHit(), chunk: { ...textHit().chunk, workspaceId: 'other' } },
  ]);
  await expect(searchSourceText('w1', 'solar')).rejects.toThrow(
    'outside the current workspace',
  );
  get.mockRejectedValue(new Error('Forbidden'));
  await expect(searchSourceText('w1', 'solar')).rejects.toThrow('Forbidden');
});
it('creates immutable version-aware page and span links and labels all supported locations', () => {
  expect(passagePath(textHit())).toBe(
    '/app/workspaces/w1/sources/s1?version=v1&processingVersion=p1&page=14&unit=unit-14',
  );
  expect(passageLocation(textHit())).toBe('page 14');
  const ranged = { ...textHit(), chunk: { ...textHit().chunk, pageEnd: 15 } };
  expect(passageLocation(ranged)).toBe('pages 14–15');
  const section = textHit('c1', null);
  expect(passageLocation(section)).toBe('Temperature dependence');
  const unit = { ...section, chunk: { ...section.chunk, sectionTitle: null } };
  expect(passageLocation(unit)).toBe('location unit-14');
  const unknown = { ...unit, chunk: { ...unit.chunk, spans: [] } };
  expect(passageLocation(unknown)).toBe('Source passage');
  expect(passagePath(unknown)).toBe(
    '/app/workspaces/w1/sources/s1?version=v1&processingVersion=p1',
  );
});
