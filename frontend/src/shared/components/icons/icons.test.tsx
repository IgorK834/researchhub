/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { Icon, iconNames, iconRegistry, SearchIcon } from './icons';

const designNames =
  'search home book library file text note sparkle chart lineChart scatter users user sliders help plus minus chevDown chevUp chevRight chevLeft sort check x upload download link quote comment clock history calendar folder table grid code terminal play refresh more arrowRight arrowLeft arrowUp arrowDown pencil highlight trash lock key shield eye bell bold italic heading list undo redo image globe filter star warn alert info flask layers columns bookmark send database panel mail logout archive copy external wifi wifiOff cursor'.split(
    ' ',
  );

it('exposes exactly the 80 design names in source order', () => {
  expect(iconNames).toEqual(designNames);
});

it.each(iconNames)(
  'renders %s at every size from 14 to 20 with the shared SVG contract',
  (name) => {
    const Component = iconRegistry[name];
    for (const size of [14, 15, 16, 17, 18, 19, 20] as const) {
      const { container, unmount } = render(<Component size={size} />);
      const svg = container.querySelector('svg');
      expect(svg?.getAttribute('viewBox')).toBe('0 0 24 24');
      expect(svg?.getAttribute('width')).toBe(String(size));
      expect(svg?.getAttribute('height')).toBe(String(size));
      expect(svg?.getAttribute('stroke')).toBe('currentColor');
      expect(svg?.getAttribute('stroke-width')).toBe('1.75');
      expect(svg?.getAttribute('stroke-linecap')).toBe('round');
      expect(svg?.getAttribute('stroke-linejoin')).toBe('round');
      expect(svg?.getAttribute('fill')).toBe('none');
      expect(svg?.getAttribute('aria-hidden')).toBe('true');
      expect(svg?.getAttribute('focusable')).toBe('false');
      expect(svg?.children.length).toBeGreaterThan(0);
      unmount();
    }
  },
);

it('supports meaningful labelled images, decorative defaults and native SVG props', () => {
  const { rerender } = render(
    <Icon name="search" label="Search sources" className="search" data-testid="icon" />,
  );
  const icon = screen.getByRole('img', { name: 'Search sources' });
  expect(icon.getAttribute('width')).toBe('16');
  expect(icon.classList.contains('search')).toBe(true);
  expect(icon.hasAttribute('aria-hidden')).toBe(false);
  rerender(<SearchIcon label="   " />);
  expect(screen.queryByRole('img')).toBeNull();
});
