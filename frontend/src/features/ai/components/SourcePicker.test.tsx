/** @jest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
import { SourcePicker, type PickableSource } from './SourcePicker';
import { ScopeChip } from '../../../shared/components/ScopeChip';

const sources: readonly PickableSource[] = [
  { id: 'pdf', title: 'Paper', sourceType: 'PDF', status: 'READY' },
  { id: 'csv', title: 'Data', sourceType: 'CSV', status: 'READY' },
  { id: 'processing', title: 'Processing paper', status: 'PROCESSING' },
  { id: 'uploaded', title: 'Uploaded notes', status: 'UPLOADED' },
  { id: 'failed', title: 'Failed file', sourceType: 'TXT', status: 'FAILED' },
  { id: 'future', title: 'Future file', sourceType: 'FUTURE', status: 'FUTURE' },
];
it('keeps every processing state visible, explains unavailable selection and selects only ready sources', () => {
  const onChange = jest.fn();
  const view = render(<SourcePicker sources={sources} value={[]} onChange={onChange} />);
  expect(screen.getByText('No sources selected. The answer will have no evidence.')).toBeTruthy();
  for (const source of sources) {
    const checkbox = screen.getByRole('checkbox', { name: source.title });
    expect(checkbox).toHaveProperty('disabled', source.status !== 'READY');
    if (source.status !== 'READY') {
      const description = document.getElementById(checkbox.getAttribute('aria-describedby')!);
      expect(description?.textContent).toMatch(/selected|processing/);
    }
  }
  fireEvent.click(screen.getByRole('button', { name: 'Select all ready' }));
  expect(onChange).toHaveBeenLastCalledWith(['pdf', 'csv']);
  view.rerender(<SourcePicker sources={sources} value={['pdf']} onChange={onChange} />);
  fireEvent.click(screen.getByLabelText('Data'));
  expect(onChange).toHaveBeenLastCalledWith(['pdf', 'csv']);
  fireEvent.click(screen.getByLabelText('Paper'));
  expect(onChange).toHaveBeenLastCalledWith([]);
  fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
  expect(onChange).toHaveBeenLastCalledWith([]);
});
it('represents null as the authorized workspace scope and never converts Clear into all', () => {
  const onChange = jest.fn();
  render(<SourcePicker sources={sources} value={null} onChange={onChange} />);
  expect(screen.getByText('Ask across 2 sources · All workspace sources')).toBeTruthy();
  expect(screen.getByLabelText('Paper')).toHaveProperty('checked', true);
  expect(screen.getByLabelText('Paper')).toHaveProperty('disabled', true);
  expect(screen.queryByText('No sources selected. The answer will have no evidence.')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
  expect(onChange).toHaveBeenCalledWith([]);
});
it('supports unavailable/empty libraries and caller-owned disabling', () => {
  render(<SourcePicker sources={[]} value={[]} disabled onChange={jest.fn()} legend="Comparison sources" action="Compare" />);
  expect(screen.getByText('No ready sources available.')).toBeTruthy();
  expect(screen.getByRole('group', { name: 'Comparison sources' })).toHaveProperty('disabled', true);
  expect(screen.getByText('Compare 0 sources · Selected sources')).toBeTruthy();
});
it('names a single-source scope and accepts a specific source label', () => {
  const view = render(<ScopeChip selectedSourceIds={['pdf']} readyCount={12} />);
  expect(screen.getByText('Ask across 1 source · Selected sources')).toBeTruthy();
  view.rerender(<ScopeChip selectedSourceIds={null} readyCount={12} sourceLabel="Asking Paper" />);
  expect(screen.getByText('Asking Paper')).toBeTruthy();
});
