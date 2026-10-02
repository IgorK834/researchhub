/** @jest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
import { SourceDetailFrame } from './SourceDetailFrame';
import { desktopMedia } from '../../../shared/testing/desktopMedia';
it('keeps preview input state alive when moving between the docked reader and embedded details', () => {
  const frame = (embedded: boolean) => (
    <SourceDetailFrame
      embedded={embedded}
      header={<h1>Lecture.pdf</h1>}
      metadata={<p>Metadata</p>}
    >
      <input aria-label="Preview selection" defaultValue="Page 1" />
    </SourceDetailFrame>
  );
  const view = render(frame(false));
  const input = screen.getByLabelText('Preview selection');
  fireEvent.change(input, { target: { value: 'Page 2' } });
  expect(screen.getByRole('region', { name: 'Source reader' })).toBeTruthy();
  view.rerender(frame(true));
  expect(screen.getByLabelText('Preview selection')).toBe(input);
  expect(input).toHaveProperty('value', 'Page 2');
  view.rerender(frame(false));
  expect(screen.getByLabelText('Preview selection')).toBe(input);
  expect(screen.getByText('Metadata')).toBeTruthy();
});
it('opens metadata in the shared narrow context panel', () => {
  const media = desktopMedia(true);
  try {
    render(
      <SourceDetailFrame
        embedded={false}
        header={<h1>Lecture</h1>}
        metadata={<p>Metadata</p>}
      >
        <p>Extraction</p>
      </SourceDetailFrame>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open source metadata' }));
    expect(screen.getByRole('dialog', { name: 'Source metadata' })).toBeTruthy();
    expect(screen.getByText('Metadata')).toBeTruthy();
  } finally {
    media.restore();
  }
});
