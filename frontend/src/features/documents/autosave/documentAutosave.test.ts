import type { SaveKind } from '../api/documentApi';
import type { ProseMirrorDocument } from '../api/documentContent';
import {
  DocumentAutosave,
  type AutosaveState,
  type DocumentDraft,
} from './documentAutosave';

/**
 * The autosave rules, with fake timers and a save function the test resolves by hand.
 *
 * Holding each request open is what makes the interesting cases expressible: an edit made while a save is in
 * flight, a response that arrives after newer typing, a second flush that must wait.
 */

const TIMING = { debounceMs: 1000, maxWaitMs: 5000 } as const;

function doc(text: string): ProseMirrorDocument {
  return {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  };
}

function draft(text: string, title = 'Final report'): DocumentDraft {
  return { title, content: doc(text) };
}

interface PendingSave {
  readonly draft: DocumentDraft;
  readonly revision: number;
  readonly saveKind: SaveKind;
  readonly resolve: (revision: number) => void;
  readonly reject: (error: unknown) => void;
}

const CONFLICT = { kind: 'conflict' };
const OFFLINE = new Error('The backend could not be reached');

function harness(initialRevision = 1): {
  autosave: DocumentAutosave;
  saves: PendingSave[];
  states: AutosaveState[];
  latest: () => AutosaveState;
} {
  const saves: PendingSave[] = [];
  const states: AutosaveState[] = [];
  const autosave = new DocumentAutosave({
    initialDraft: draft('Original'),
    initialRevision,
    timing: TIMING,
    save: (sent, revision, saveKind) =>
      new Promise((resolve, reject) => {
        saves.push({
          draft: sent,
          revision,
          saveKind,
          resolve: (stored) => resolve({ revision: stored }),
          reject,
        });
      }),
    isConflict: (error) => error === CONFLICT,
    onChange: (state) => states.push(state),
  });
  return {
    autosave,
    saves,
    states,
    latest: () => states[states.length - 1] ?? autosave.state,
  };
}

/** Lets promise callbacks run. */
async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('DocumentAutosave', () => {
  it('starts saved, at the revision it was opened with', () => {
    const { autosave } = harness(4);

    expect(autosave.state).toEqual({
      status: 'saved',
      revision: 4,
      error: null,
      blocked: false,
    });
    expect(autosave.hasUnsavedChanges).toBe(false);
  });

  it('does not send a request per keystroke, only once typing pauses', () => {
    const { autosave, saves, latest } = harness();

    for (let key = 1; key <= 20; key += 1) {
      autosave.edit(draft('x'.repeat(key)));
      jest.advanceTimersByTime(100);
    }

    expect(saves).toHaveLength(0);
    expect(latest().status).toBe('unsaved');

    jest.advanceTimersByTime(TIMING.debounceMs);

    expect(saves).toHaveLength(1);
    expect(saves[0]?.draft).toEqual(draft('x'.repeat(20)));
    expect(saves[0]?.revision).toBe(1);
    expect(saves[0]?.saveKind).toBe('AUTOSAVE');
    expect(latest().status).toBe('saving');
  });

  it('bounds the save frequency while somebody types without pausing', async () => {
    const { autosave, saves } = harness();
    let resolved = 0;

    // 30 seconds of a keystroke every 200 ms: the debounce never fires, so only the max wait does.
    for (let tick = 1; tick <= 150; tick += 1) {
      autosave.edit(draft(`typing ${String(tick)}`));
      jest.advanceTimersByTime(200);
      expect(saves.length - resolved).toBeLessThanOrEqual(1);
      const inFlight = saves[resolved];
      if (inFlight !== undefined) {
        resolved += 1;
        inFlight.resolve(inFlight.revision + 1);
        await settle();
      }
    }

    // One save per max-wait window (5 s) over 30 s, give or take the edges.
    expect(saves.length).toBeGreaterThanOrEqual(5);
    expect(saves.length).toBeLessThanOrEqual(7);
    // Each save was based on the revision the previous one returned.
    expect(saves.map((save) => save.revision)).toEqual(
      saves.map((_, index) => index + 1),
    );
  });

  it('marks everything saved when the response covers the last edit', async () => {
    const { autosave, saves, latest } = harness();
    autosave.edit(draft('Done'));
    jest.advanceTimersByTime(TIMING.debounceMs);

    saves[0]?.resolve(2);
    await settle();

    expect(latest()).toEqual({
      status: 'saved',
      revision: 2,
      error: null,
      blocked: false,
    });
    expect(autosave.hasUnsavedChanges).toBe(false);
  });

  it('keeps one save in flight and sends newer edits after it with the new revision', async () => {
    const { autosave, saves, latest } = harness();
    autosave.edit(draft('First'));
    jest.advanceTimersByTime(TIMING.debounceMs);

    autosave.edit(draft('Second'));
    jest.advanceTimersByTime(TIMING.debounceMs);

    expect(saves).toHaveLength(1);
    expect(latest().status).toBe('saving');

    saves[0]?.resolve(2);
    await settle();

    expect(saves).toHaveLength(2);
    expect(saves[1]?.draft).toEqual(draft('Second'));
    expect(saves[1]?.revision).toBe(2);
  });

  it('never lets an older response mark newer edits as saved', async () => {
    const { autosave, saves, latest } = harness();
    autosave.edit(draft('Old'));
    jest.advanceTimersByTime(TIMING.debounceMs);
    autosave.edit(draft('Newer'));

    saves[0]?.resolve(2);
    await settle();

    expect(latest().status).toBe('unsaved');
    expect(latest().revision).toBe(2);
    expect(autosave.hasUnsavedChanges).toBe(true);

    jest.advanceTimersByTime(TIMING.debounceMs);
    expect(saves[1]?.draft).toEqual(draft('Newer'));
    saves[1]?.resolve(3);
    await settle();

    expect(latest()).toEqual({
      status: 'saved',
      revision: 3,
      error: null,
      blocked: false,
    });
  });

  it('reports a failure, keeps the edits, and does not retry on its own', async () => {
    const { autosave, saves, latest } = harness();
    autosave.edit(draft('Unsaved work'));
    jest.advanceTimersByTime(TIMING.debounceMs);

    saves[0]?.reject(OFFLINE);
    await settle();

    expect(latest().status).toBe('failed');
    expect(latest().error).toBe(OFFLINE);
    expect(latest().revision).toBe(1);
    expect(autosave.hasUnsavedChanges).toBe(true);

    jest.advanceTimersByTime(60_000);
    expect(saves).toHaveLength(1);
  });

  it('retries a failure on request, with the same revision', async () => {
    const { autosave, saves, latest } = harness();
    autosave.edit(draft('Unsaved work'));
    jest.advanceTimersByTime(TIMING.debounceMs);
    saves[0]?.reject(OFFLINE);
    await settle();

    autosave.retry();

    expect(saves).toHaveLength(2);
    expect(saves[1]?.draft).toEqual(draft('Unsaved work'));
    expect(saves[1]?.revision).toBe(1);
    saves[1]?.resolve(2);
    await settle();
    expect(latest().status).toBe('saved');
  });

  it('retries a failure after the next edit', async () => {
    const { autosave, saves, latest } = harness();
    autosave.edit(draft('Unsaved'));
    jest.advanceTimersByTime(TIMING.debounceMs);
    saves[0]?.reject(OFFLINE);
    await settle();

    autosave.edit(draft('Unsaved, and more'));

    expect(latest().status).toBe('unsaved');
    jest.advanceTimersByTime(TIMING.debounceMs);
    expect(saves[1]?.draft).toEqual(draft('Unsaved, and more'));
  });

  it('ignores retry when nothing failed', () => {
    const { autosave, saves } = harness();

    autosave.retry();

    expect(saves).toHaveLength(0);
  });

  it('stops saving on a conflict and keeps the newest local text unsent', async () => {
    const { autosave, saves, latest } = harness();
    autosave.edit(draft('Mine'));
    jest.advanceTimersByTime(TIMING.debounceMs);
    saves[0]?.reject(CONFLICT);
    await settle();

    expect(latest().status).toBe('conflict');
    expect(latest().error).toBe(CONFLICT);

    autosave.edit(draft('Mine, still typing'));
    jest.advanceTimersByTime(60_000);
    autosave.saveNow();
    autosave.flush();
    autosave.retry();

    expect(saves).toHaveLength(1);
    expect(latest().status).toBe('conflict');
    expect(autosave.hasUnsavedChanges).toBe(true);
  });

  it('drops a queued flush when the save in flight fails', async () => {
    const { autosave, saves } = harness();
    autosave.edit(draft('A'));
    jest.advanceTimersByTime(TIMING.debounceMs);
    autosave.edit(draft('B'));
    jest.advanceTimersByTime(TIMING.debounceMs);

    saves[0]?.reject(OFFLINE);
    await settle();

    expect(saves).toHaveLength(1);
  });

  it('sends an explicit save immediately, as a manual save, even with nothing changed', () => {
    const { autosave, saves } = harness(3);

    autosave.saveNow();

    expect(saves).toHaveLength(1);
    expect(saves[0]?.saveKind).toBe('MANUAL');
    expect(saves[0]?.revision).toBe(3);
    expect(saves[0]?.draft).toEqual(draft('Original'));
  });

  it('queues an explicit save behind the one in flight rather than sending two at once', async () => {
    const { autosave, saves, latest } = harness();
    autosave.edit(draft('Typing'));
    jest.advanceTimersByTime(TIMING.debounceMs);

    autosave.saveNow();
    expect(saves).toHaveLength(1);

    saves[0]?.resolve(2);
    await settle();

    expect(saves).toHaveLength(2);
    expect(saves[1]?.saveKind).toBe('MANUAL');
    expect(saves[1]?.revision).toBe(2);
    saves[1]?.resolve(3);
    await settle();
    expect(latest().status).toBe('saved');
  });

  it('does not send a draft with a blank title, and says why', () => {
    const { autosave, saves, latest } = harness();

    autosave.edit(draft('Body', '   '));
    jest.advanceTimersByTime(TIMING.debounceMs);
    autosave.saveNow();

    expect(saves).toHaveLength(0);
    expect(latest()).toMatchObject({ status: 'unsaved', blocked: true });

    autosave.edit(draft('Body', 'Renamed'));
    jest.advanceTimersByTime(TIMING.debounceMs);

    expect(saves).toHaveLength(1);
    expect(saves[0]?.draft.title).toBe('Renamed');
  });

  it('flushes pending edits immediately when asked, as when the user leaves', () => {
    const { autosave, saves } = harness();
    autosave.edit(draft('Last words'));

    autosave.flush();

    expect(saves).toHaveLength(1);
    expect(saves[0]?.draft).toEqual(draft('Last words'));
    jest.advanceTimersByTime(TIMING.maxWaitMs);
    expect(saves).toHaveLength(1);
  });

  it('flushes nothing when nothing is pending', () => {
    const { autosave, saves } = harness();

    autosave.flush();

    expect(saves).toHaveLength(0);
  });

  it('sends nothing after being disposed', () => {
    const { autosave, saves } = harness();
    autosave.edit(draft('Abandoned timer'));

    autosave.dispose();
    jest.advanceTimersByTime(TIMING.maxWaitMs);

    expect(saves).toHaveLength(0);
  });
});
