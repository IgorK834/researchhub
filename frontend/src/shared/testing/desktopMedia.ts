import { jest } from '@jest/globals';

/** Deterministic matchMedia with a real change subscription; restore before the next test. */
export function desktopMedia(initial = false) {
  const original = window.matchMedia;
  let narrow = initial;
  const listeners = new Set<() => void>();
  window.matchMedia = jest.fn((media: string) => ({
    media,
    get matches() {
      return narrow;
    },
    onchange: null,
    addEventListener: (_: string, listener: EventListenerOrEventListenerObject) => {
      listeners.add(listener as () => void);
    },
    removeEventListener: (_: string, listener: EventListenerOrEventListenerObject) => {
      listeners.delete(listener as () => void);
    },
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => true,
  }));
  return {
    resize(value: boolean) {
      narrow = value;
      listeners.forEach((listener) => listener());
    },
    restore() {
      window.matchMedia = original;
    },
  };
}
