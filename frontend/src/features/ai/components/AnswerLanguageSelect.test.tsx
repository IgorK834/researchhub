/** @jest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AnswerLanguageSelect } from './AnswerLanguageSelect';
import { setLocale } from '../../../shared/i18n';
afterEach(() => {
  cleanup();
  setLocale('en');
});
it('localizes labels while keeping the explicitly selected answer language unchanged', () => {
  const change = jest.fn();
  render(<AnswerLanguageSelect value="en" onChange={change} />);
  fireEvent.change(screen.getByLabelText('Answer language'), { target: { value: 'pl' } });
  expect(change).toHaveBeenCalledWith('pl');
  act(() => setLocale('pl'));
  expect(screen.getByLabelText('Język odpowiedzi')).toHaveProperty('value', 'en');
  expect(change).toHaveBeenCalledTimes(1);
});
