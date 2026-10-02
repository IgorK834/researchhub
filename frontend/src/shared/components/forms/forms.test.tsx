/** @jest-environment jsdom */
import { createRef, useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import {
  TextField,
  Textarea,
  Select,
  Checkbox,
  Toggle,
  SegmentedControl,
  ChoiceCards,
  type Choice,
} from './index';

it('associates label, external description, hint and unmodified server error; removes stale errors', () => {
  const ref = createRef<HTMLInputElement>();
  const change = jest.fn();
  const { rerender } = render(
    <>
      <p id="privacy">Never shared.</p>
      <TextField
        id="email"
        name="email"
        label="Email"
        hint="University address"
        error="Adres jest już zajęty."
        aria-describedby="privacy"
        value="a@uni.edu"
        onChange={change}
        ref={ref}
        className="custom"
        type="email"
        autoComplete="email"
      />
    </>,
  );
  const input = screen.getByRole('textbox', { name: 'Email' });
  expect(input).toBe(ref.current);
  expect(input.getAttribute('aria-describedby')).toBe('privacy email-hint email-error');
  expect(input.getAttribute('aria-invalid')).toBe('true');
  expect(document.getElementById('email-error')?.textContent).toBe(
    'Adres jest już zajęty.',
  );
  expect(document.querySelector('#email-error svg')?.getAttribute('aria-hidden')).toBe(
    'true',
  );
  expect(input.classList.contains('custom')).toBe(true);
  fireEvent.change(input, { target: { value: 'b@uni.edu' } });
  expect(change).toHaveBeenCalledTimes(1);
  rerender(<TextField id="email" label="Email" />);
  expect(screen.getByRole('textbox').hasAttribute('aria-describedby')).toBe(false);
  expect(screen.getByRole('textbox').getAttribute('aria-invalid')).toBe('false');
  expect(document.getElementById('email-error')).toBeNull();
});

it('generates unique ids and supports native password, search, disabled and read-only controls', () => {
  const { container } = render(
    <>
      <TextField label="Password" type="password" defaultValue="private" size="large" />
      <TextField label="Search" type="search" keycap="⌘K" disabled />
      <TextField
        label="Reference"
        readOnly
        icon="book"
        defaultValue="Known"
        aria-invalid="true"
      />
    </>,
  );
  const password = screen.getByLabelText('Password') as HTMLInputElement;
  expect(password.type).toBe('password');
  expect(password.classList.contains('large')).toBe(true);
  expect(screen.getByRole('searchbox')).toHaveProperty('disabled', true);
  expect(screen.getByRole('textbox')).toHaveProperty('readOnly', true);
  expect(screen.getByRole('textbox').getAttribute('aria-invalid')).toBe('true');
  expect(
    new Set(Array.from(container.querySelectorAll('input')).map((input) => input.id))
      .size,
  ).toBe(3);
  expect(container.querySelector('kbd')?.getAttribute('aria-hidden')).toBe('true');
  expect(container.querySelectorAll('.leading svg').length).toBe(2);
});

it('provides native textarea and select with the same associations, refs and events', () => {
  const textarea = createRef<HTMLTextAreaElement>();
  const select = createRef<HTMLSelectElement>();
  const change = jest.fn();
  const { rerender } = render(
    <>
      <Textarea
        id="description"
        label="Description"
        hint="Optional"
        error="Too long"
        ref={textarea}
        className="custom"
        onChange={change}
      />
      <Select
        id="role"
        label="Role"
        hint="Access level"
        error="Choose a role"
        ref={select}
        className="custom"
        onChange={change}
      >
        <option value="EDITOR">Editor</option>
        <option value="VIEWER">Viewer</option>
      </Select>
    </>,
  );
  expect(screen.getByRole('textbox')).toBe(textarea.current);
  expect(screen.getByRole('combobox')).toBe(select.current);
  expect(select.current?.getAttribute('aria-describedby')).toBe('role-hint role-error');
  expect(textarea.current?.getAttribute('aria-describedby')).toBe(
    'description-hint description-error',
  );
  fireEvent.change(select.current!, { target: { value: 'VIEWER' } });
  fireEvent.change(textarea.current!, { target: { value: 'Research' } });
  expect(change).toHaveBeenCalledTimes(2);
  rerender(
    <>
      <Textarea label="Description" />
      <Select label="Role">
        <option>Editor</option>
      </Select>
    </>,
  );
  expect(screen.getByRole('combobox').getAttribute('aria-invalid')).toBe('false');
  expect(screen.getByRole('textbox').hasAttribute('aria-describedby')).toBe(false);
});

it.each([Checkbox, Toggle])(
  'keeps binary inputs native and wires messages to their accessible names',
  (Control) => {
    const ref = createRef<HTMLInputElement>();
    const change = jest.fn();
    const { rerender } = render(
      <Control
        id="source-reference"
        name="source-reference"
        label="Include source reference"
        hint="Keeps its origin"
        error="Required"
        onChange={change}
        ref={ref}
        className="custom"
      />,
    );
    const input = screen.getByLabelText('Include source reference');
    expect(input).toBe(ref.current);
    expect(ref.current?.type).toBe('checkbox');
    expect(input.getAttribute('aria-describedby')).toBe(
      'source-reference-hint source-reference-error',
    );
    expect(input.classList.contains('custom')).toBe(true);
    fireEvent.click(input);
    expect(ref.current?.checked).toBe(true);
    expect(change).toHaveBeenCalledTimes(1);
    rerender(<Control label="Include source reference" disabled defaultChecked />);
    expect(screen.getByLabelText('Include source reference')).toHaveProperty(
      'disabled',
      true,
    );
  },
);

const options: readonly Choice<'required' | 'possible' | 'off' | 'blocked'>[] = [
  {
    value: 'required',
    label: 'Required',
    description: 'Every claim cites its origin',
    icon: 'shield',
  },
  { value: 'blocked', label: 'Unavailable', disabled: true },
  { value: 'possible', label: 'Where possible', description: 'Use available sources' },
  { value: 'off', label: 'Off' },
];
it.each([false, true])(
  'operates %s choice cards with arrows, Home/End and one tab stop, skipping disabled options',
  (cards) => {
    const Group = cards ? ChoiceCards : SegmentedControl;
    function Example() {
      const [value, setValue] = useState<(typeof options)[number]['value'] | undefined>();
      return (
        <form>
          <Group
            id="citations"
            name="citations"
            label="Citations"
            hint="Choose a policy"
            error="Choose one"
            options={options}
            value={value}
            onChange={setValue}
            required
          />
        </form>
      );
    }
    render(<Example />);
    const required = screen.getByRole('radio', { name: 'Required' }) as HTMLInputElement;
    const possible = screen.getByRole('radio', {
      name: 'Where possible',
    }) as HTMLInputElement;
    const off = screen.getByRole('radio', { name: 'Off' }) as HTMLInputElement;
    expect(required.tabIndex).toBe(0);
    required.focus();
    fireEvent.keyDown(required, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(possible);
    expect(possible.checked).toBe(true);
    fireEvent.keyDown(possible, { key: 'ArrowDown' });
    expect(off.checked).toBe(true);
    fireEvent.keyDown(off, { key: 'ArrowRight' });
    expect(required.checked).toBe(true);
    fireEvent.keyDown(required, { key: 'ArrowLeft' });
    expect(off.checked).toBe(true);
    fireEvent.keyDown(off, { key: 'Home' });
    expect(required.checked).toBe(true);
    fireEvent.keyDown(required, { key: 'End' });
    expect(off.checked).toBe(true);
    fireEvent.keyDown(off, { key: 'ArrowUp' });
    expect(possible.checked).toBe(true);
    fireEvent.keyDown(possible, { key: 'Tab' });
    expect(possible.checked).toBe(true);
    fireEvent.click(required);
    expect(required.checked).toBe(true);
    expect(
      screen.getAllByRole('radio').filter((radio) => radio.tabIndex === 0),
    ).toHaveLength(1);
    expect(
      screen
        .getByRole('radiogroup', { name: 'Citations' })
        .getAttribute('aria-describedby'),
    ).toBe('citations-hint citations-error');
    if (cards)
      expect(
        document.getElementById(required.getAttribute('aria-describedby')!)?.textContent,
      ).toBe(options[0]!.description);
    else expect(required.hasAttribute('aria-describedby')).toBe(false);
  },
);

it('does not select disabled groups, and supports an empty or entirely disabled group', () => {
  const change = jest.fn();
  const { rerender } = render(
    <SegmentedControl
      label="Policy"
      options={options}
      value="required"
      onChange={change}
      disabled
    />,
  );
  fireEvent.keyDown(screen.getByRole('radio', { name: 'Required' }), {
    key: 'ArrowRight',
  });
  expect(change).not.toHaveBeenCalled();
  rerender(
    <ChoiceCards label="Policy" options={[]} value={undefined} onChange={change} />,
  );
  expect(screen.queryByRole('radio')).toBeNull();
  rerender(
    <ChoiceCards
      label="Policy"
      options={[{ value: 'only', label: 'Only', disabled: true }]}
      value={undefined}
      onChange={change}
    />,
  );
  fireEvent.keyDown(screen.getByRole('radio'), { key: 'ArrowRight' });
  expect(change).not.toHaveBeenCalled();
});
