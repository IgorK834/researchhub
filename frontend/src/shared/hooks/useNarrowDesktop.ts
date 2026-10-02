import { useSyncExternalStore } from 'react';

/** Keep in sync with the shell/table CSS breakpoint. Smaller-device layouts are not designed yet. */
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
