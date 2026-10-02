/** @jest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import {
  SOURCE_TYPE_VISUALS,
  SOURCE_STATUS_LABELS,
  SOURCE_STATUS_VISUALS,
} from '../api/sourceTypes';
import { SourceTypeBadge, SourceTypeTile, SourceStatusChip } from './SourceVisuals';
import { formatSourceBytes } from './sourcePresentation';

afterEach(cleanup);
it.each([
  ['PDF', 'coral', 'lucide-file-text'],
  ['DOCX', 'blue', 'lucide-text-align-start'],
  ['XLSX', 'mint', 'lucide-table'],
  ['CSV', 'mint', 'lucide-grid-2x2'],
  ['TXT', 'yellow', 'lucide-text-align-start'],
] as const)(
  'renders the %s badge and tile with the designated tint and icon',
  (sourceType, tone, iconClass) => {
    const { container } = render(
      <>
        <SourceTypeBadge sourceType={sourceType} />
        <SourceTypeTile sourceType={sourceType} />
      </>,
    );
    expect(screen.getByText(sourceType).className).toContain(tone);
    expect(container.querySelectorAll('svg')).toHaveLength(2);
    for (const svg of container.querySelectorAll('svg'))
      expect(svg.getAttribute('class')).toContain(iconClass);
    expect(SOURCE_TYPE_VISUALS[sourceType].tone).toBe(tone);
    const tile = container.lastElementChild!;
    expect(tile.getAttribute('aria-hidden')).toBe('true');
    expect(tile.className).toContain(tone);
    expect(tile.className).toContain('large');
  },
);
it.each([
  ['UPLOADED', 'neutral', 'lucide-upload'],
  ['PROCESSING', 'yellow', 'lucide-refresh-cw'],
  ['READY', 'mint', 'lucide-check'],
  ['FAILED', 'coral', 'lucide-circle-alert'],
] as const)('renders %s with a visible word and icon', (status, tone, iconClass) => {
  render(<SourceStatusChip status={status} />);
  const badge = screen.getByText(SOURCE_STATUS_LABELS[status]);
  expect(badge.className).toContain(tone);
  expect(SOURCE_STATUS_VISUALS[status].tone).toBe(tone);
  expect(badge.querySelector('svg')?.getAttribute('class')).toContain(iconClass);
  expect(badge.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
});
it.each(['EPUB', 'constructor', 'toString', ''])(
  'uses a neutral visual for future or malformed values (%s)',
  (value) => {
    const { container } = render(
      <>
        <SourceTypeBadge sourceType={value} />
        <SourceTypeTile sourceType={value} size="default" />
        <SourceStatusChip status={value} />
      </>,
    );
    expect(container.children[0]!.className).toContain('neutral');
    expect(container.children[1]!.className).toContain('neutral');
    expect(container.children[1]!.className).toContain('default');
    expect(container.children[2]!.className).toContain('neutral');
    expect(container.children[0]!.textContent).toBe(value || 'Source');
    expect(container.children[2]!.textContent).toBe(value || 'Unknown status');
  },
);
it.each([
  [10, '10 B'],
  [2048, '2.0 KB'],
  [1048576, '1.0 MB'],
] as const)('formats %s bytes without invented metadata', (size, expected) => {
  expect(formatSourceBytes(size)).toBe(expected);
});
