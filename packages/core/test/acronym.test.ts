import { describe, expect, it } from 'vitest';
import { acronym, isCapital } from '../src/acronym.js';
import type { LetterInfo } from '../src/motion/types.js';

const letter = (char: string): LetterInfo => ({ char, index: 0, count: 1 });

describe('isCapital', () => {
  it('takes letters whose lower case differs from themselves', () => {
    for (const ch of 'ABZÉÅΔ') expect(isCapital(ch), ch).toBe(true);
    for (const ch of 'abzéåδ') expect(isCapital(ch), ch).toBe(false);
  });

  it('drops what has no case at all', () => {
    // An acronym is made of letters. Digits and punctuation are equal to both their cases, so a
    // test of "differs from its lower case" alone would keep them.
    for (const ch of '0 9 . , ! - / & \n'.split(' ')) expect(isCapital(ch), ch).toBe(false);
  });

  it('is safe on a letter sampled without a block behind it', () => {
    expect(isCapital(undefined)).toBe(false);
  });
});

describe('acronym', () => {
  const [text, options] = acronym('Keep\nLighting\nInteresting');

  it('hands back the text it was given', () => {
    expect(text).toBe('Keep\nLighting\nInteresting');
  });

  it('holds the block to be read, then drops in place, then gathers', () => {
    expect(options.hold).toBe('click');
    const [drop, gather] = options.stages ?? [];
    // `place` is the whole reason the lower case leaving is its own beat: on 'line' the capitals
    // would already be travelling while the rest was still fading.
    expect(drop?.as).toBe('place');
    // No pause and no move: the capitals start gathering as the lower case finishes leaving.
    expect(drop?.hold).toBe(0);
    expect(drop?.tween?.duration).toBe(0);
    expect(gather?.as).toBe('line');
    expect(gather?.hold).toBe('click');
  });

  it('keeps the capitals and tints them apart from the body', () => {
    const keep = options.stages?.[0]?.keep;
    expect(keep?.(letter('K'))).toBe(true);
    expect(keep?.(letter('e'))).toBe(false);

    const tint = options.tint as (l: LetterInfo) => number | undefined;
    expect(tint(letter('K'))).toBe(0x2df0ff);
    // Undefined, not a colour: the body is left whatever the look makes it.
    expect(tint(letter('e'))).toBeUndefined();
  });

  it('lets a caller override every beat', () => {
    const [, custom] = acronym('Ab', {
      caps: { tint: 0xff0000 },
      body: { tint: 0x111111 },
      read: 2000,
      settle: 'click',
      hold: 5000,
      exit: 'drop',
      active: 'float',
    });
    const tint = custom.tint as (l: LetterInfo) => number | undefined;
    expect(custom.hold).toBe(2000);
    expect(tint(letter('A'))).toBe(0xff0000);
    expect(tint(letter('b'))).toBe(0x111111);
    expect(custom.stages?.[0]?.hold).toBe('click');
    expect(custom.stages?.[0]?.exit).toBe('drop');
    expect(custom.stages?.[1]?.active).toBe('float');
    expect(custom.stages?.[1]?.hold).toBe(5000);
  });
});
