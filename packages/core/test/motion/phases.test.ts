import { describe, expect, it, vi } from 'vitest';
import { isolate, type PhaseEvent, PhaseReporter } from '../../src/motion/phases.js';

const INF = Number.POSITIVE_INFINITY;

describe('PhaseReporter', () => {
  it('reports active once the enter has run its length, and only once', () => {
    const seen: PhaseEvent[] = [];
    const r = new PhaseReporter((e) => seen.push(e));

    r.observe(50, 100, 500);
    expect(seen).toEqual([]);

    r.observe(100, 100, 500);
    r.observe(160, 100, 500);
    expect(seen).toEqual([{ phase: 'active' }]);
  });

  it('withholds exit while the hold is still open, then reports it once released', () => {
    const seen: PhaseEvent[] = [];
    const r = new PhaseReporter((e) => seen.push(e));

    // A click hold: no exit instant exists yet, however far the clock runs.
    r.observe(0, 0, INF);
    r.observe(60_000, 0, INF);
    expect(seen).toEqual([{ phase: 'active' }]);

    // release() has now rebuilt the timeline and put activeEnd at 60_000.
    r.observe(60_016, 0, 60_000);
    r.observe(60_032, 0, 60_000);
    expect(seen).toEqual([{ phase: 'active' }, { phase: 'exit' }]);
  });

  it('passes a stage index straight through', () => {
    const seen: PhaseEvent[] = [];
    const r = new PhaseReporter((e) => seen.push(e));

    r.stage(0);
    r.stage(1);
    expect(seen).toEqual([
      { phase: 'stage', index: 0 },
      { phase: 'stage', index: 1 },
    ]);
  });
});

describe('isolate', () => {
  it('sends a throwing listener to the microtask queue instead of the caller', () => {
    const queued: (() => void)[] = [];
    vi.stubGlobal('queueMicrotask', (fn: () => void) => queued.push(fn));

    const emit = isolate(() => {
      throw new Error('host');
    });

    expect(() => emit({ phase: 'active' })).not.toThrow();
    expect(queued).toHaveLength(1);
    expect(queued[0]).toThrow('host');

    vi.unstubAllGlobals();
  });
});
