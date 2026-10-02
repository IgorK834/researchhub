/** jsdom has no layout engine; browser verification covers actual popup positioning. */
export function installResizeObserver(): () => void {
  const original = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
  return () => {
    globalThis.ResizeObserver = original;
  };
}
