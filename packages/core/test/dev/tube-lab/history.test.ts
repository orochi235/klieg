import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLabHistory } from '../../../dev/tube-lab/src/history.js';

function store(initial: number) {
  const box = { value: initial };
  return { box, write: (v: number) => (box.value = v) };
}

describe('the lab history', () => {
  afterEach(() => vi.useRealTimers());

  it('takes back a write and makes it again', () => {
    const history = createLabHistory();
    const { box, write } = store(1);
    write(2);
    history.push('radius', 1, 2, write);
    history.undo();
    expect(box.value).toBe(1);
    history.redo();
    expect(box.value).toBe(2);
  });

  it('runs a burst of writes to one path into one step, and a pause into two', () => {
    vi.useFakeTimers();
    const history = createLabHistory();
    const { box, write } = store(0);
    for (const v of [1, 2, 3]) {
      history.push('letters', box.value, v, write);
      write(v);
      vi.advanceTimersByTime(100);
    }
    vi.advanceTimersByTime(1000);
    history.push('letters', 3, 4, write);
    write(4);
    history.undo();
    expect(box.value).toBe(3);
    history.undo();
    expect(box.value).toBe(0);
    expect(history.canUndo()).toBe(false);
    history.redo();
    expect(box.value).toBe(3);
  });

  it('steps an entry a trial records in order with its own, and drops redo on a new one', () => {
    const history = createLabHistory();
    const { box, write } = store(0);
    const trial = { value: 'a' };
    write(1);
    history.push('radius', 0, 1, write);
    const op = {
      label: 'config',
      apply: () => {},
      invert: () => ({
        label: 'config',
        apply: () => {
          trial.value = 'a';
        },
        invert: () => ({
          label: 'config',
          apply: () => {
            trial.value = 'b';
          },
          invert: () => op,
        }),
      }),
    };
    trial.value = 'b';
    history.record(op, 'config');
    history.undo();
    expect([trial.value, box.value]).toEqual(['a', 1]);
    history.undo();
    expect(box.value).toBe(0);
    history.redo();
    history.push('runs', 1, 5, write);
    expect(history.canRedo()).toBe(false);
  });
});
