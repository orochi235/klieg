import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearDraftFaults,
  draftFaults,
  guarded,
  lineOfError,
} from '../../dev/composition-lab/src/draft.js';
import type { EffectPiece } from '../../src/effects/types.js';
import { NO_CTX } from '../effects/ctx.js';

const part = {
  kind: 'run' as const,
  index: 0,
  count: 1,
  letter: { index: 0, count: 1 },
  x: 0,
  y: 0,
  ink: { minX: 0, maxX: 0, minY: 0, maxY: 0 },
  at: 0,
  span: 1,
};

const THROWS: EffectPiece = {
  duration: 1000,
  at: () => {
    throw new Error('nope');
  },
};

describe('guarded', () => {
  beforeEach(clearDraftFaults);

  // A draft pane exists to run code that does not work yet. A throw on the second part of the pool
  // used to take the whole lab down with it.
  it('rests rather than throwing, so one bad call does not kill the frame', () => {
    expect(guarded(THROWS).at(0, part, NO_CTX)).toEqual({});
  });

  it('keeps the pass it was given', () => {
    expect(guarded(THROWS).duration).toBe(1000);
  });

  it('counts the calls that threw and keeps the first message', () => {
    const piece = guarded(THROWS);
    piece.at(0, part, NO_CTX);
    piece.at(0.5, part, NO_CTX);
    expect(draftFaults()).toEqual({ throws: 2, message: 'nope' });
  });

  it('keeps the first message rather than the last, which is the one nearest the cause', () => {
    let n = 0;
    const piece = guarded({
      duration: 1,
      at: () => {
        n += 1;
        throw new Error(`throw ${n}`);
      },
    });
    piece.at(0, part, NO_CTX);
    piece.at(0, part, NO_CTX);
    expect(draftFaults().message).toBe('throw 1');
  });

  it('passes a working piece straight through', () => {
    const piece = guarded({ duration: 1, at: () => ({ gain: 0.5 }) });
    expect(piece.at(0, part, NO_CTX)).toEqual({ gain: 0.5 });
    expect(draftFaults().throws).toBe(0);
  });
});

// The blob wraps the body in a factory, so every line the engine names is one below the pane's.
describe('lineOfError', () => {
  it('takes the line off a blob url and moves it back onto the pane', () => {
    expect(lineOfError('at blob:http://localhost:5183/8f2c-4a:5:11')).toBe(4);
  });

  it('answers nothing when the engine named no position', () => {
    expect(lineOfError('SyntaxError: Unexpected end of input')).toBeNull();
  });

  it('never answers a line above the first, whatever the wrapper reports', () => {
    expect(lineOfError('at blob:http://localhost:5183/8f2c-4a:1:1')).toBe(1);
  });
});
