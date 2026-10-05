import type { Host, Setting } from '../../src/effects/types.js';

/** One frame as a test describes it. `now` is both the mix's timestamp and the instance clock. */
export interface Frame {
  pointer?: Host['pointer'];
  pointerInWord?: Host['pointerInWord'];
  now?: number;
  /** Milliseconds since the subject last advanced; `Infinity` under reduced motion. Default 16. */
  dt?: number;
  /** The voice's own clock. Defaults to `now`. */
  elapsed?: number;
}

/**
 * Settings from one voice, as the mix hands them out: what `keep` holds lasts across frames, per
 * subject. A stateful signal asked through two `voice()`s keeps two states, as two voices do.
 */
export function voice(): (frame?: Frame, subject?: object) => Setting {
  const kept = new Map<object, Map<object, unknown>>();
  const SOLE = {};
  return (frame = {}, subject = SOLE) => {
    const store = kept.get(subject) ?? new Map<object, unknown>();
    kept.set(subject, store);
    const now = frame.now ?? 0;
    return {
      timestamp: now,
      dt: frame.dt ?? 16,
      elapsed: frame.elapsed ?? now,
      pass: 0,
      weight: 1,
      state: undefined,
      host: {
        pointer: frame.pointer ?? null,
        pointerInWord: frame.pointerInWord ?? null,
        now,
      },
      keep<K>(owner: object, init: () => K): K {
        if (!store.has(owner)) store.set(owner, init());
        return store.get(owner) as K;
      },
      send() {},
    };
  };
}

/** A setting with nothing in it: no pointer, at time 0, for patches and signals that keep no state. */
export const NO_CTX: Setting = voice()();
export const AT: Setting = voice()({
  pointer: { x: 0.5, y: -0.5 },
  pointerInWord: { x: 1.2, y: 0.3 },
});
