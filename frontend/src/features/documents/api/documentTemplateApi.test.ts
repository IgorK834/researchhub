import { apiClient } from '../../../shared/api';
import {
  fetchDocumentTemplates,
  createDocumentFromTemplate,
} from './documentTemplateApi';
jest.mock('../../../shared/api', () => ({
  apiClient: { get: jest.fn(), post: jest.fn() },
}));
it('escapes the workspace path, carries cancellation and posts the explicit immutable selection', async () => {
  const signal = new AbortController().signal;
  await fetchDocumentTemplates('w/a', 'pl', signal);
  expect(apiClient.get).toHaveBeenCalledWith(
    '/api/workspaces/w%2Fa/document-templates?locale=pl',
    { signal },
  );
  await fetchDocumentTemplates('w', 'en');
  expect(apiClient.get).toHaveBeenLastCalledWith(
    '/api/workspaces/w/document-templates?locale=en',
    { signal: undefined },
  );
  const input = {
    clientRequestId: 'nonce',
    templateId: 'lab-report',
    version: 1,
    locale: 'en' as const,
    title: '1.25 m',
  };
  await createDocumentFromTemplate('w/a', input);
  expect(apiClient.post).toHaveBeenCalledWith(
    '/api/workspaces/w%2Fa/documents/from-template',
    { body: input },
  );
});
