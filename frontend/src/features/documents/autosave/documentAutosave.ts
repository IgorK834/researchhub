import type { SaveKind } from '../api/documentApi';
import type { ProseMirrorDocument } from '../api/documentContent';

/**
 * Autosave for one open document, with no React in it.
 *
 * The rules this exists to keep:
 *
 * - **Bounded save frequency.** An edit does not save; it (re)starts a debounce timer, and the save happens when
 *   typing pauses for {@link AutosaveTiming.debounceMs}. A `maxWaitMs` timer, started by the first unsaved edit,
 *   makes sure somebody who never pauses is still saved at least that often. There is never more than one save in
 *   flight: an edit made meanwhile waits for it, then goes out as the next save with the revision it returned.
 * - **An old response never wins.** A response only advances the revision and marks as saved the edits that were
 *   in the request. Edits made while it was in flight stay unsaved and go out next. Nothing here ever hands the
 *   server's content back to the editor — the local document is always the newest one.
 * - **A refused save keeps the text.** A failure stops autosaving until the next edit or an explicit retry, so a
 *   backend that is down is not hammered, and the status says the work is unsaved. A conflict stops autosaving
 *   entirely: the user decides what happens to their text.
 */

/** The values a save writes. */
export interface DocumentDraft {
  readonly title: string;
  readonly content: ProseMirrorDocument;
}

/**
 * - `saved`: everything on screen is stored.
 * - `unsaved`: there are edits waiting for the debounce, for the save in flight, or for a valid title.
 * - `saving`: a request is in flight.
 * - `failed`: the last save failed. The edits are still here and unsaved; the next edit or a retry tries again.
 * - `conflict`: somebody else saved first. Autosave has stopped; nothing will be sent until the page reloads.
 */
export type AutosaveStatus = 'saved' | 'unsaved' | 'saving' | 'failed' | 'conflict';

export interface AutosaveState {
  readonly status: AutosaveStatus;
  /** The stored revision the next save is based on. Advances only when a save succeeds. */
  readonly revision: number;
  /** The error behind `failed` or `conflict`, otherwise `null`. */
  readonly error: unknown;
  /** True when the local draft is not a valid document to save — today, a blank title. */
  readonly blocked: boolean;
}

export interface AutosaveTiming {
  /** How long typing must pause before a save. */
  readonly debounceMs: number;
  /** The longest an unsaved edit waits while typing continues. */
  readonly maxWaitMs: number;
}

export interface AutosaveOptions {
  readonly initialDraft: DocumentDraft;
  readonly initialRevision: number;
  readonly timing: AutosaveTiming;
  /** Sends one save. Resolves with the stored revision, rejects with the error. */
  readonly save: (
    draft: DocumentDraft,
    revision: number,
    saveKind: SaveKind,
  ) => Promise<{ readonly revision: number }>;
  /** Whether an error means somebody else changed the document, as opposed to a failure worth retrying. */
  readonly isConflict: (error: unknown) => boolean;
  /** Called with every new state. */
  readonly onChange: (state: AutosaveState) => void;
}

/** A draft the server would refuse outright. Not sent, so a half-typed title is not reported as a failure. */
function isSavable(draft: DocumentDraft): boolean {
  return draft.title.trim().length > 0;
}

export class DocumentAutosave {
  private readonly options: AutosaveOptions;

  private draft: DocumentDraft;
  private revision: number;
  private status: AutosaveStatus = 'saved';
  private error: unknown = null;

  /** Counts edits. A save records the value it sent, so its response knows which edits it covered. */
  private generation = 0;
  private savedGeneration = 0;

  private inFlight = false;
  /** A flush arrived while a save was in flight. It runs as soon as that save settles. */
  private flushQueued = false;
  /** The user asked for a save, which is always sent and always a milestone, even with nothing changed. */
  private manualRequested = false;

  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private maxWaitTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: AutosaveOptions) {
    this.options = options;
    this.draft = options.initialDraft;
    this.revision = options.initialRevision;
  }

  get state(): AutosaveState {
    return {
      status: this.status,
      revision: this.revision,
      error: this.error,
      blocked: !isSavable(this.draft),
    };
  }

  /** True when something on screen is not stored. */
  get hasUnsavedChanges(): boolean {
    return this.generation !== this.savedGeneration;
  }

  /** Records an edit and schedules a save. Never sends anything by itself. */
  edit(draft: DocumentDraft): void {
    this.draft = draft;
    this.generation += 1;

    if (this.status === 'conflict') {
      // Keep the newest text in memory, but never send it: the user has not decided yet.
      this.emit();
      return;
    }

    if (!this.inFlight) {
      this.status = 'unsaved';
      this.error = null;
    }

    this.clearTimer('debounce');
    this.debounceTimer = setTimeout(() => this.flush(), this.options.timing.debounceMs);
    if (this.maxWaitTimer === null) {
      this.maxWaitTimer = setTimeout(() => this.flush(), this.options.timing.maxWaitMs);
    }
    this.emit();
  }

  /** An explicit save: sent now (or right after the one in flight), and recorded as a milestone. */
  saveNow(): void {
    if (this.status === 'conflict') {
      return;
    }
    this.manualRequested = true;
    this.flush();
  }

  /** Tries the failed save again with the current draft. */
  retry(): void {
    if (this.status === 'failed') {
      this.flush();
    }
  }

  /**
   * Sends pending edits now instead of waiting for the timers. Used when the user leaves the document, so the
   * last few seconds of typing are not lost. A no-op when nothing is pending or a conflict is showing.
   */
  flush(): void {
    this.clearTimer('debounce');
    this.clearTimer('maxWait');

    if (this.status === 'conflict') {
      return;
    }
    if (this.inFlight) {
      this.flushQueued = true;
      return;
    }
    if (!this.hasUnsavedChanges && !this.manualRequested) {
      return;
    }
    if (!isSavable(this.draft)) {
      this.manualRequested = false;
      this.status = 'unsaved';
      this.emit();
      return;
    }

    this.send(this.manualRequested ? 'MANUAL' : 'AUTOSAVE');
  }

  /** Stops the timers without sending anything. */
  dispose(): void {
    this.clearTimer('debounce');
    this.clearTimer('maxWait');
  }

  private send(saveKind: SaveKind): void {
    const sentGeneration = this.generation;
    this.manualRequested = false;
    this.inFlight = true;
    this.status = 'saving';
    this.error = null;
    this.emit();

    this.options.save(this.draft, this.revision, saveKind).then(
      (stored) => {
        this.inFlight = false;
        this.revision = stored.revision;
        this.savedGeneration = sentGeneration;
        this.settle();
      },
      (error: unknown) => {
        this.inFlight = false;
        this.flushQueued = false;
        this.error = error;
        this.status = this.options.isConflict(error) ? 'conflict' : 'failed';
        if (this.status === 'conflict') {
          this.dispose();
        }
        this.emit();
      },
    );
  }

  /** After a successful save: done, or send what arrived while it was in flight. */
  private settle(): void {
    if (!this.hasUnsavedChanges && !this.manualRequested) {
      this.status = 'saved';
      this.flushQueued = false;
      this.emit();
      return;
    }

    // Edits made during the save are newer than what it stored. They stay unsaved, and the timers they started
    // are still running — unless one already fired while the save was in flight, in which case go now.
    this.status = 'unsaved';
    this.emit();
    if (this.flushQueued || this.manualRequested) {
      this.flushQueued = false;
      this.flush();
    }
  }

  private clearTimer(which: 'debounce' | 'maxWait'): void {
    const timer = which === 'debounce' ? this.debounceTimer : this.maxWaitTimer;
    if (timer !== null) {
      clearTimeout(timer);
    }
    if (which === 'debounce') {
      this.debounceTimer = null;
    } else {
      this.maxWaitTimer = null;
    }
  }

  private emit(): void {
    this.options.onChange(this.state);
  }
}
