import { apiClient } from '../../../shared/api';
import {
  prepareCalculationProposal,
  acceptCanvasProposal,
  fetchCanvasProposal,
  rejectCanvasProposal,
  undoCanvasOperation,
  type CanvasProposal,
} from './canvasProposalApi';
jest.mock('../../../shared/api', () => ({
  ...jest.requireActual('../../../shared/api'),
  apiClient: {
    get: jest.fn().mockResolvedValue({}),
    post: jest.fn().mockResolvedValue({}),
  },
}));
it('primes CSRF, binds route scope and sends only immutable operation identities', async () => {
  const proposal = { id: 'p', versionHash: 'a'.repeat(64) } as CanvasProposal;
  await fetchCanvasProposal('w', 'doc', 'p', new AbortController().signal);
  await fetchCanvasProposal('w', 'doc', 'p');
  await acceptCanvasProposal('w', 'doc', proposal, 'operation');
  await rejectCanvasProposal('w', 'doc', 'p');
  await undoCanvasOperation('w', 'doc', 'operation', 'undo');
  expect(apiClient.post).toHaveBeenCalledWith(
    '/api/workspaces/w/documents/doc/ai/proposals/p/accept',
    { body: { clientOperationId: 'operation', versionHash: proposal.versionHash } },
  );
  expect(apiClient.post).toHaveBeenCalledWith(
    '/api/workspaces/w/documents/doc/ai/operations/operation/undo',
    { body: { clientOperationId: 'undo' } },
  );
  expect(apiClient.get).toHaveBeenCalledTimes(5);
});

test('saved calculation preparation primes CSRF and sends exact selection', async () => {
  const request = {
    clientProposalId: 'p',
    contextId: 'ctx',
    analysisId: 'a',
    executionId: 'e',
    selection: 'FULL' as const,
    outputId: null,
    conversationId: null,
    turnId: null,
  };
  await prepareCalculationProposal('w /', 'd /', request);
  expect(apiClient.post).toHaveBeenLastCalledWith(
    '/api/workspaces/w%20%2F/documents/d%20%2F/ai/proposals/calculation',
    { body: request },
  );
});
