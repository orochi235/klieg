import { bench, describe } from 'vitest';
import { EffectFrame, planEffects } from '../../src/effects/frame.js';
import type { EffectPiece, PartInfo } from '../../src/effects/types.js';
import { blankPose, Timeline } from '../../src/motion/compositor.js';
import type { LetterInfo, MotionPiece } from '../../src/motion/types.js';

/**
 * What one frame of the mix costs, so the schema's open question about `at` writing into a buffer
 * has a number to answer to. A frame is every letter posed and every part resolved once; the
 * budget it has to fit inside is 16.7ms.
 */

const LETTERS = 12;
const PARTS = 60;
const EFFECTS = 3;

const drift: MotionPiece = {
  duration: 900,
  offset: (t, letter) => ({
    position: [Math.sin(t * 6.28 + letter.index), t * 0.1, 0],
    rotation: [0, t * 0.2, 0],
    scale: 1 + t * 0.05,
    opacity: 1 - t * 0.1,
  }),
};

const timeline = new Timeline({
  enter: drift,
  active: [drift, drift],
  exit: drift,
  hold: 1200,
  blendMs: 300,
});

const letters: LetterInfo[] = Array.from({ length: LETTERS }, (_, index) => ({
  char: 'a',
  index,
  count: LETTERS,
  line: 0,
  column: index,
  lineCount: 1,
  columnCount: LETTERS,
  x: index,
  y: 0,
}));
const scratch = letters.map(() => blankPose());

const flick: EffectPiece = {
  duration: 700,
  at: (t, part) => ({
    gain: 0.5 + 0.5 * Math.sin(t * 6.28 + part.index),
    dark: t * 0.2,
    crawl: t * 0.1,
    light: { color: 0xffcc66, amount: t },
  }),
};

const parts: PartInfo[] = Array.from({ length: PARTS }, (_, index) => ({
  kind: 'run',
  index,
  count: PARTS,
  letter: letters[index % LETTERS] as LetterInfo,
  x: index,
  y: 0,
  ink: { minX: 0, maxX: 1, minY: 0, maxY: 1 },
  at: index / PARTS,
  span: 1 / PARTS,
}));

const frame = new EffectFrame(
  planEffects(
    Array.from({ length: EFFECTS }, () => ({
      piece: flick,
      target: { kind: 'run' as const, by: 'index' as const, amount: 1 },
      stagger: 0.4,
    })),
    parts,
  ),
);
const ctx = { pointer: null, pointerInWord: null, dt: 16, now: 0 };

let now = 0;

describe('one frame of the mix', () => {
  bench(`${LETTERS} letters posed`, () => {
    now += 16;
    for (let i = 0; i < LETTERS; i++) {
      timeline.poseAt(now % 2400, letters[i] as LetterInfo, scratch[i]);
    }
  });

  bench(`${PARTS} parts resolved under ${EFFECTS} effects`, () => {
    now += 16;
    frame.resolve(parts, now, { ...ctx, now });
  });
});
