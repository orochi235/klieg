import type { TrialHistorySource } from '@weasel-js/labkit';

type Op = Parameters<TrialHistorySource['record']>[0];

/** A write within this long of the last one to the same path is the same gesture: a burst of typing. */
const GESTURE_MS = 500;

interface Entry {
  op: Op;
  at: number;
}

/**
 * One undo order for the whole lab. Every trial hands it over with `useTrialHistory`, so any trial's Undo, Redo and
 * their keys step it, and labkit records each trial's settings changes onto it beside the rail's own writes.
 */
export interface LabHistory extends TrialHistorySource {
  /**
   * Records a write that has already landed: `write(before)` takes it back. A write to the path the last one
   * wrote, within a gesture, extends that entry rather than starting one.
   */
  push<T>(path: string, before: T, after: T, write: (value: T) => void): void;
}

/** A step over one value, which catches the value to redo to when it is taken back. */
function valueOp<T>(before: T, read: () => T, write: (value: T) => void): Op {
  const forward: Op = {
    label: 'shared',
    apply: () => {},
    invert: () => {
      const after = read();
      const back: Op = {
        label: 'shared',
        apply: () => write(before),
        invert: () => ({ label: 'shared', apply: () => write(after), invert: () => back }),
      };
      return back;
    },
  };
  return forward;
}

export function createLabHistory(): LabHistory {
  const undos: Entry[] = [];
  let redos: Entry[] = [];
  let last: { path: string; at: number; set: (value: unknown) => void } | null = null;
  const listeners = new Set<() => void>();
  const changed = () => {
    for (const listener of listeners) listener();
  };

  const step = (from: Entry[], to: Entry[]) => {
    const entry = from.pop();
    if (!entry) return;
    const inverse = entry.op.invert();
    inverse.apply(undefined);
    to.push({ op: inverse, at: entry.at });
    last = null;
    changed();
  };

  return {
    canUndo: () => undos.length > 0,
    canRedo: () => redos.length > 0,
    undo: () => step(undos, redos),
    redo: () => step(redos, undos),
    undoStamp: () => undos.at(-1)?.at,
    redoStamp: () => redos.at(-1)?.at,
    dropRedo: () => {
      redos = [];
      changed();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    record: (op) => {
      undos.push({ op, at: Date.now() });
      redos = [];
      last = null;
      changed();
    },
    push: (path, before, after, write) => {
      const now = Date.now();
      if (last && last.path === path && now - last.at < GESTURE_MS && undos.length > 0) {
        last.at = now;
        last.set(after);
        return;
      }
      // Where redo lands: a later write in the same gesture moves it.
      let current = after;
      const op = valueOp(
        before,
        () => current,
        (value) => {
          current = value;
          write(value);
        },
      );
      undos.push({ op, at: now });
      redos = [];
      last = {
        path,
        at: now,
        set: (value) => {
          current = value as typeof after;
        },
      };
      changed();
    },
  };
}

/** The lab's one history, shared by the rail and every trial. */
export const labHistory = createLabHistory();
