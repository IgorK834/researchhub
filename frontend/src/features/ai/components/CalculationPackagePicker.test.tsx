/** @jest-environment jsdom */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CalculationPackagePicker } from './CalculationPackagePicker';
import * as api from '../api/canvasProposalApi';
import type { AnalysisReference } from '../../documents/api/analysisReference';
jest.mock('../api/canvasProposalApi');
jest.mock('../../analysis/components/AnalysisOutputPicker', () => ({
  AnalysisOutputPicker: ({ onChoose }: { onChoose: (r: AnalysisReference) => void }) => (
    <>
      {(['SOLUTION', 'TABLE', 'CHART'] as const).map((mode) => (
        <button
          key={mode}
          onClick={() =>
            onChoose({
              analysisId: 'a',
              executionId: 'e',
              outputId: mode.toLowerCase(),
              renderMode: mode,
            })
          }
        >
          Use {mode}
        </button>
      ))}
    </>
  ),
}));
jest.mock('./CanvasProposalPreview', () => ({
  CanvasProposalPreview: ({ proposalId }: { proposalId: string }) => (
    <p>Preview {proposalId}</p>
  ),
}));
test('retry preserves package identity, preview is explicit and selection changes identity', async () => {
  jest
    .mocked(api.prepareCalculationProposal)
    .mockRejectedValueOnce(new Error('Network failure'))
    .mockResolvedValue({ id: 'p' } as never);
  const view = render(
    <CalculationPackagePicker
      workspaceId="w"
      documentId="doc"
      contextId="ctx"
      conversationId="c"
      turnId="t"
      canApply
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Use SOLUTION' }));
  fireEvent.click(screen.getByRole('button', { name: 'Preview saved package' }));
  await screen.findByRole('alert');
  const first = jest.mocked(api.prepareCalculationProposal).mock.calls[0]![2];
  expect(first).toMatchObject({
    contextId: 'ctx',
    selection: 'FULL',
    outputId: null,
    conversationId: 'c',
    turnId: 't',
  });
  fireEvent.click(screen.getByRole('button', { name: 'Preview saved package' }));
  await screen.findByText('Preview p');
  expect(api.prepareCalculationProposal).toHaveBeenLastCalledWith('w', 'doc', first);
  fireEvent.click(screen.getByRole('button', { name: 'Use TABLE' }));
  fireEvent.change(screen.getByLabelText('Package contents'), {
    target: { value: 'TABLE' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Preview saved package' }));
  await screen.findByText('Preview p');
  expect(jest.mocked(api.prepareCalculationProposal).mock.calls[2]![2]).toMatchObject({
    selection: 'TABLE',
    outputId: 'table',
  });
  expect(
    jest.mocked(api.prepareCalculationProposal).mock.calls[2]![2].clientProposalId,
  ).not.toBe(first.clientProposalId);
  fireEvent.click(screen.getByRole('button', { name: 'Use CHART' }));
  expect(screen.getByRole('option', { name: 'Selected chart only' })).toBeTruthy();
  view.rerender(
    <CalculationPackagePicker
      workspaceId="w"
      documentId="doc"
      contextId="ctx"
      canApply={false}
    />,
  );
  expect(
    (screen.getByRole('button', { name: 'Preview saved package' }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});
test('standalone saved package has no invented conversation', async () => {
  jest.mocked(api.prepareCalculationProposal).mockResolvedValue({ id: 'p' } as never);
  render(
    <CalculationPackagePicker
      workspaceId="w"
      documentId="doc"
      contextId="ctx"
      canApply
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Use CHART' }));
  fireEvent.click(screen.getByRole('button', { name: 'Preview saved package' }));
  await waitFor(() => expect(api.prepareCalculationProposal).toHaveBeenCalled());
  expect(api.prepareCalculationProposal).toHaveBeenLastCalledWith(
    'w',
    'doc',
    expect.objectContaining({ conversationId: null, turnId: null, selection: 'FULL' }),
  );
});
