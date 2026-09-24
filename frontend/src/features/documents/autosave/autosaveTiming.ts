import type { AutosaveTiming } from './documentAutosave';

/**
 * When the document editor saves on its own.
 *
 * 1.5 seconds of quiet is long enough that a person typing a sentence produces one save, not one per word; ten
 * seconds is the longest continuous typing goes unsaved. With at most one request in flight, that bounds an
 * editor at roughly one save per pause and never more than one every 1.5 seconds.
 *
 * In a module of its own so a test can replace it with shorter values.
 */
export const AUTOSAVE_TIMING: AutosaveTiming = {
  debounceMs: 1500,
  maxWaitMs: 10_000,
};
