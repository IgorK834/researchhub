import { useSyncExternalStore } from 'react';

/** Context docking follows the shell/table breakpoint; CSS stacks tool navigation below 801px. */
export const NARROW_DESKTOP_QUERY = '(max-width: 1280px)';
function subscribe(notify: () => void): () => void {
  if (!window.matchMedia) return () => {};
  const query = window.matchMedia(NARROW_DESKTOP_QUERY);
  query.addEventListener('change', notify);
  return () => query.removeEventListener('change', notify);
}
function snapshot(): boolean {
  return window.matchMedia?.(NARROW_DESKTOP_QUERY).matches ?? false;
}
export function useNarrowDesktop(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
