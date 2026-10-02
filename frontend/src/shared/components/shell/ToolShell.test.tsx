/** @jest-environment jsdom */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { desktopMedia } from '../../testing/desktopMedia';
import { ToolShell } from './ToolShell';
import { AppShell } from './AppShell';

it('composes one main landmark with ordered rail, secondary column, main area and docked context', () => {
  render(
    <AppShell
      tool
      sidebar={
        <nav aria-label="Rail">
          <a href="/app">Home</a>
        </nav>
      }
      breadcrumb="Document"
    >
      <ToolShell
        label="Editor"
        secondary={<a href="/documents">Documents</a>}
        context={<input aria-label="Question" />}
        contextFooter={<button>Send</button>}
      >
        <input aria-label="Text" />
      </ToolShell>
    </AppShell>,
  );
  expect(screen.getAllByRole('main')).toHaveLength(1);
  expect(screen.getByRole('navigation', { name: 'Tool navigation' })).toBeTruthy();
  const panel = screen.getByRole('complementary', { name: 'Context panel' });
  expect(
    within(panel).getByRole('button', { name: 'Send' }).closest('footer'),
  ).toBeTruthy();
  const controls = [...document.querySelectorAll('a,input,button')].map(
    (node) => node.getAttribute('aria-label') ?? node.textContent,
  );
  expect(controls).toEqual([
    'Skip to content',
    'Home',
    'Documents',
    'Text',
    'Question',
    'Send',
  ]);
});

it('keeps draft inputs mounted when moving to a slide-over and back, traps focus and returns it', () => {
  const media = desktopMedia();
  try {
    render(
      <ToolShell
        label="Editor"
        contextTitle="Research"
        context={<input aria-label="Question" />}
        contextFooter={<button>Send</button>}
      >
        Document
      </ToolShell>,
    );
    const input = screen.getByLabelText('Question');
    fireEvent.change(input, { target: { value: 'Keep this draft' } });
    act(() => media.resize(true));
    expect(screen.queryByRole('complementary')).toBeNull();
    const trigger = screen.getByRole('button', { name: 'Open research' });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Research' });
    expect(within(dialog).getByLabelText('Question')).toBe(input);
    expect(input).toHaveProperty('value', 'Keep this draft');
    const send = within(dialog).getByRole('button', { name: 'Send' });
    expect(send.closest('footer')).toBeTruthy();
    send.focus();
    fireEvent.keyDown(send, { key: 'Tab' });
    expect(document.activeElement).toBe(
      within(dialog).getByRole('button', { name: 'Close' }),
    );
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    act(() => media.resize(false));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByLabelText('Question')).toBe(input);
    expect(input).toHaveProperty('value', 'Keep this draft');
  } finally {
    media.restore();
  }
});

it('supports explicit docked/slide-over modes and optional slots', () => {
  const media = desktopMedia(true);
  try {
    const { rerender } = render(
      <ToolShell
        label="Reader"
        secondaryWidth={280}
        contextMode="docked"
        context="Metadata"
      >
        PDF
      </ToolShell>,
    );
    expect(screen.getByRole('complementary')).toBeTruthy();
    rerender(
      <ToolShell label="Reader" contextMode="slide-over" context="Metadata">
        PDF
      </ToolShell>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open context panel' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    rerender(<ToolShell label="Reader">PDF</ToolShell>);
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  } finally {
    media.restore();
  }
});
